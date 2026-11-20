begin;

create function painel_privado.comanda_mesa_sem_recebimento(p public.pedidos_online)
returns boolean language sql stable set search_path = '' as $$
  select not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null
    and not exists (select 1 from public.vendas v where v.id=p.id and v.empresa_id=p.empresa_id)
    and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p.id);
$$;

create or replace function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos, p.itens, exists(select 1 from public.adicionais_comanda a where a.pedido_id=p.id and a.estado<>'entregue') as adicionais_pendentes,
      public.ajuste_comanda_pendente(p.id) as ajuste_pendente, public.cancelamento_comanda_pendente(p.id) as cancelamento_pendente,
      public.pix_frente_pedido_pendente(p.id) as pix_presencial_pendente
    from public.pedidos_online p
    where p.empresa_id = p_empresa and p.mesa is not null and p.estado = 'entregue'
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and painel_privado.comanda_mesa_sem_recebimento(p)
      and (btrim(p_busca) = '' or p.mesa::text = btrim(p_busca) or p.comanda::text = btrim(p_busca))
    order by p.comanda limit 100
  ) c;
$$;

create function painel_privado.comandas_mesa_abertas(p_empresa uuid,p_numero integer)
returns bigint language sql stable set search_path = '' as $$
  select count(*) from public.pedidos_online p
  where p.empresa_id=p_empresa and p.mesa=p_numero
    and (p.estado in ('novo','preparo','pronto') and not exists (
      select 1 from public.vendas v where v.id=p.id and v.empresa_id=p_empresa
    ) or p.estado='entregue' and painel_privado.comanda_mesa_sem_recebimento(p));
$$;

create function public.painel_mesas(p_empresa uuid,p_acao text,p_numero integer default null,p_ativo boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  contexto jsonb := public.painel_contexto_sessao(p_empresa);
  empresa uuid := (contexto->>'empresa_id')::uuid;
  mesa public.mesas_cardapio;
begin
  if contexto->>'escopo' is distinct from 'loja' then
    raise insufficient_privilege using message='Acesso negado';
  end if;

  if p_acao='criar' then
    perform public.configurar_mesa_cardapio(empresa,p_numero);
  elsif p_acao='situacao' then
    if p_numero is null or p_ativo is null then
      raise invalid_parameter_value using message='Informe a mesa e a situação.';
    end if;
    select * into mesa from public.mesas_cardapio m
      where m.empresa_id=empresa and m.numero=p_numero for update;
    if not found then raise sqlstate 'PT404' using message='Mesa indisponível.'; end if;
    if mesa.ativo and not p_ativo and painel_privado.comandas_mesa_abertas(empresa,p_numero)>0 then
      raise sqlstate 'PT409' using message='Encerre as comandas da mesa antes de desativar.';
    end if;
    update public.mesas_cardapio m set ativo=p_ativo
      where m.token=mesa.token and m.ativo is distinct from p_ativo;
  elsif p_acao is distinct from 'listar' then
    raise invalid_parameter_value using message='Operação de mesa inválida.';
  end if;

  return (select jsonb_build_object('loja',e.cardapio_slug,'mesas',coalesce((
    select jsonb_agg(jsonb_build_object('numero',m.numero,'ativo',m.ativo,'criado_em',m.criado_em,
        'mesa',case when m.ativo then m.token end,
        'comandas_abertas',painel_privado.comandas_mesa_abertas(empresa,m.numero)) order by m.numero)
    from public.mesas_cardapio m where m.empresa_id=empresa),'[]'))
    from public.empresas e where e.id=empresa);
end;
$$;

revoke all on function painel_privado.comanda_mesa_sem_recebimento(public.pedidos_online),
  painel_privado.comandas_mesa_abertas(uuid,integer),public.painel_mesas(uuid,text,integer,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.painel_mesas(uuid,text,integer,boolean) to authenticated;

commit;
