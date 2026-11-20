begin;

create table painel_privado.avisos_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_online(id),
  enviado_por uuid not null,
  mensagem text not null check (char_length(btrim(mensagem)) between 1 and 240),
  criado_em timestamptz not null default clock_timestamp()
);
create index on painel_privado.avisos_pedido(pedido_id,criado_em desc,id desc);
alter table painel_privado.avisos_pedido enable row level security;
revoke all on painel_privado.avisos_pedido from public,anon,authenticated,service_role;

create function painel_privado.avisos_recentes(p_pedido uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('mensagem',a.mensagem,'criado_em',a.criado_em)
    order by a.criado_em,a.id),'[]'::jsonb)
  from (select id,mensagem,criado_em from painel_privado.avisos_pedido
    where pedido_id=p_pedido order by criado_em desc,id desc limit 20) a;
$$;
revoke all on function painel_privado.avisos_recentes(uuid) from public,anon,authenticated,service_role;

create function public.enviar_aviso_pedido(p_empresa uuid,p_pedido uuid,p_mensagem text)
returns void language plpgsql security definer set search_path='' as $$
declare v_pedido public.pedidos_online; v_id uuid;
begin
  -- Aviso operacional permitido à equipe da cozinha e ao gestor.
  if not (public.eh_gestor_kds(p_empresa) or exists (
    select 1 from public.equipe_kds k where k.empresa_id=p_empresa and k.usuario_id=auth.uid()
  )) then raise insufficient_privilege; end if;
  if p_mensagem is null or char_length(btrim(p_mensagem)) not between 1 and 240 then
    raise sqlstate '22023' using message='Escreva um aviso de 1 a 240 caracteres.';
  end if;
  select p.* into v_pedido from public.pedidos_online p
    where p.id=p_pedido and p.empresa_id=p_empresa for update;
  if not found then raise insufficient_privilege; end if;
  if v_pedido.estado not in ('novo','preparo','pronto')
    or public.cancelamento_comanda_pendente(p_pedido)
    or exists (select 1 from remo.solicitacoes r where r.origem='r_sistemas'
      and r.solicitante=p_empresa and r.referencia=p_pedido::text and r.estado='entregue') then
    raise sqlstate '22023' using message='O pedido não está disponível para avisos.';
  end if;
  insert into painel_privado.avisos_pedido(pedido_id,enviado_por,mensagem)
    values(p_pedido,auth.uid(),btrim(p_mensagem)) returning id into v_id;
  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
    values(auth.uid(),'usuario','loja',p_empresa,'avisos_pedido.criar','avisos_pedido',v_id::text,
      jsonb_build_object('pedido_id',p_pedido),v_id);
end;
$$;
revoke all on function public.enviar_aviso_pedido(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.enviar_aviso_pedido(uuid,uuid,text) to authenticated;

create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
    f.item || jsonb_build_object('avisos',painel_privado.avisos_recentes(p.id),
      'pode_avisar',p.estado in ('novo','preparo','pronto') and f.item->>'estado'<>'entregue'
        and not public.cancelamento_comanda_pendente(p.id)
        and (public.eh_gestor_kds(p_empresa) or k.usuario_id is not null)) ||
      case when k.contato_cliente and p.mesa is null
        and nullif(btrim(d.endereco->>'telefone'),'') is not null
        then jsonb_build_object('telefone_cliente',d.endereco->>'telefone') else '{}'::jsonb end ||
      jsonb_build_object('edita_comanda',public.pode_editar_comanda_kds(p_empresa),
      'ajuste_pendente',public.ajuste_comanda_pendente(p.id),
      'cancelamento_pendente',public.cancelamento_comanda_pendente(p.id)) ||
      case when f.item ? 'adicional' then jsonb_build_object('recebido',
        exists(select 1 from public.vendas where id=p.id)) else '{}'::jsonb end ||
      case when f.item ? 'adicional' or p.itens_preparo_original is null then '{}'::jsonb
      else jsonb_build_object('itens',coalesce((select jsonb_agg(i - array['preco_centavos','produto_id'])
        from jsonb_array_elements(p.itens_preparo_original) i),'[]'::jsonb)) end
    order by f.pos),'[]'::jsonb)
  from jsonb_array_elements(public.fila_cozinha_com_adicionais(p_empresa)) with ordinality f(item,pos)
  join public.pedidos_online p on p.id=coalesce(f.item->>'pedido_id',f.item->>'id')::uuid
  left join public.equipe_kds k on k.empresa_id=p.empresa_id and k.usuario_id=auth.uid()
  left join public.entregas_pedido d on d.pedido_id=p.id and k.contato_cliente and p.mesa is null
  where p.empresa_id=p_empresa and p.estado<>'recusado';
$$;

create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('avisos', painel_privado.avisos_recentes(p.id), 'estado', p.estado, 'estado_remo', r.estado, 'cancelado', exists(select 1 from public.cancelamentos_comanda c where c.pedido_id=p.id and c.estado='cancelado'), 'mesa', p.mesa, 'comanda', p.comanda, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or coalesce(pg.ambiente = 'sandbox', false),
    'pago', v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null,
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null, 'pix_producao', coalesce(pg.ambiente = 'producao', false))
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  left join remo.solicitacoes r on r.origem = 'r_sistemas' and r.solicitante = p.empresa_id and r.referencia = p.id::text
  left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
  left join public.pagamentos_online pg on pg.pedido_id = p.id where e.cardapio_slug = p_slug and p.id = p_id;
$$;

commit;
