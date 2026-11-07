begin;

create table public.cancelamentos_comanda (
  id uuid primary key,
  pedido_id uuid not null references public.pedidos_online(id),
  solicitado_por uuid not null references auth.users(id),
  motivo text not null check (length(btrim(motivo)) between 3 and 240),
  estado text not null check (estado in ('pendente','cancelado','negado')),
  solicitado_em timestamptz not null default now(),
  resolvido_por uuid references auth.users(id),
  resolvido_em timestamptz,
  decisao text,
  etapa_pedido text
);
create unique index cancelamentos_comanda_ativo on public.cancelamentos_comanda(pedido_id)
  where estado in ('pendente','cancelado');
create index cancelamentos_comanda_recentes on public.cancelamentos_comanda(resolvido_em desc) where estado='cancelado';
alter table public.cancelamentos_comanda enable row level security;
revoke all on public.cancelamentos_comanda from public,anon,authenticated;

alter table public.adicionais_comanda drop constraint adicionais_comanda_estado_check;
alter table public.adicionais_comanda add check (estado in ('novo','preparo','pronto','entregue','cancelado'));

create function public.cancelamento_comanda_pendente(p_pedido uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.cancelamentos_comanda where pedido_id=p_pedido and estado='pendente');
$$;

create or replace function public.ajuste_comanda_pendente(p_pedido uuid)
returns boolean language sql stable set search_path='' as $$
  select public.cancelamento_comanda_pendente(p_pedido) or
    exists(select 1 from public.ajustes_comanda where pedido_id=p_pedido and estado='pendente');
$$;

create function public.comanda_teve_preparo(p public.pedidos_online)
returns boolean language sql stable set search_path='' as $$
  select p.estado<>'novo' or exists(select 1 from public.adicionais_comanda a
    where a.pedido_id=p.id and a.estado in ('preparo','pronto','entregue') and a.itens<>'[]'::jsonb);
$$;

-- Called after locking the parent and resolving the request, in the same transaction.
create function public.efetivar_cancelamento_comanda(p public.pedidos_online,p_id uuid)
returns void language plpgsql set search_path='' as $$
begin
  if p.estado='recusado' or public.comanda_protegida(p) then
    raise exception 'A comanda já foi cancelada ou tem cobrança, pagamento ou despacho. Confira com o gestor.';
  end if;
  update public.cancelamentos_comanda set estado='cancelado',resolvido_por=auth.uid(),
    resolvido_em=now(),etapa_pedido=p.estado where id=p_id and estado='pendente';
  if not found then raise exception 'Solicitação já resolvida.'; end if;
  update public.adicionais_comanda set estado='cancelado'
    where pedido_id=p.id and estado in ('novo','preparo','pronto');
  update public.pedidos_online set estado='recusado' where id=p.id;
end;
$$;

create function public.solicitar_cancelamento_comanda(p_empresa uuid,p_pedido uuid,p_id uuid,p_motivo text)
returns text language plpgsql security definer set search_path='' as $$
declare pedido public.pedidos_online; anterior public.cancelamentos_comanda;
begin
  if not exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid()) then
    raise exception 'Acesso ao caixa da loja necessário.' using errcode='42501';
  end if;
  if p_id is null or p_motivo is null or length(btrim(p_motivo)) not between 3 and 240 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  select * into pedido from public.pedidos_online where id=p_pedido and empresa_id=p_empresa and mesa is not null for update;
  if not found then raise exception 'Comanda de mesa indisponível.'; end if;
  select * into anterior from public.cancelamentos_comanda where id=p_id;
  if found then
    if anterior.pedido_id<>p_pedido or anterior.solicitado_por<>auth.uid() or anterior.motivo<>btrim(p_motivo) then
      raise exception 'Identificador de cancelamento já utilizado.';
    end if;
    return anterior.estado;
  end if;
  if pedido.estado='recusado' or public.comanda_protegida(pedido) then
    raise exception 'Comanda indisponível ou com cobrança. Trate o pagamento com o gestor.';
  end if;
  if public.ajuste_comanda_pendente(pedido.id) then
    raise exception 'Resolva a solicitação já pendente nesta comanda.';
  end if;
  insert into public.cancelamentos_comanda(id,pedido_id,solicitado_por,motivo,estado)
    values(p_id,pedido.id,auth.uid(),btrim(p_motivo),'pendente');
  if public.comanda_teve_preparo(pedido) and not public.eh_gestor_kds(p_empresa) then return 'pendente'; end if;
  perform public.efetivar_cancelamento_comanda(pedido,p_id);
  return 'cancelado';
end;
$$;

create function public.resolver_cancelamento_comanda(p_empresa uuid,p_id uuid,p_aprovar boolean,p_decisao text)
returns void language plpgsql security definer set search_path='' as $$
declare pedido public.pedidos_online;
begin
  if not public.eh_gestor_kds(p_empresa) then
    raise exception 'Somente o gestor pode decidir sobre este cancelamento.' using errcode='42501';
  end if;
  if p_aprovar is null or (not p_aprovar and (p_decisao is null or length(btrim(p_decisao)) not between 3 and 240)) then
    raise exception 'Informe o motivo da decisão.';
  end if;
  select p.* into pedido from public.pedidos_online p join public.cancelamentos_comanda c on c.pedido_id=p.id
    where c.id=p_id and p.empresa_id=p_empresa for update of p;
  if not found then raise exception 'Solicitação indisponível.'; end if;
  if p_aprovar then
    perform public.efetivar_cancelamento_comanda(pedido,p_id);
  else
    update public.cancelamentos_comanda set estado='negado',resolvido_por=auth.uid(),resolvido_em=now(),
      decisao=btrim(p_decisao),etapa_pedido=pedido.estado where id=p_id and estado='pendente';
    if not found then raise exception 'Solicitação já resolvida.'; end if;
  end if;
end;
$$;

create function public.comandas_para_cancelar(p_empresa uuid,p_busca text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('gestor',public.eh_gestor_kds(p_empresa),'comandas',coalesce(jsonb_agg(to_jsonb(q)
    order by (q.solicitacao is not null) desc,q.comanda),'[]'::jsonb), 'historico',coalesce((
      select jsonb_agg(to_jsonb(h) order by h.horario desc) from (
        select p.comanda,p.mesa,c.estado,c.motivo,c.decisao,c.resolvido_em horario,
          autor.email::text solicitado_por, decisor.email::text resolvido_por
        from public.cancelamentos_comanda c join public.pedidos_online p on p.id=c.pedido_id
        join auth.users autor on autor.id=c.solicitado_por join auth.users decisor on decisor.id=c.resolvido_por
        where p.empresa_id=p_empresa and c.estado in ('cancelado','negado')
          and public.eh_gestor_kds(p_empresa)
          and (btrim(p_busca)='' or p.comanda::text=btrim(p_busca) or p.mesa::text=btrim(p_busca))
        order by c.resolvido_em desc limit 30
      ) h
    ),'[]'::jsonb)) from (
    select p.id,p.comanda,p.mesa,p.cliente,p.estado,public.comanda_teve_preparo(p) iniciou_preparo,
      c.id solicitacao,c.motivo,u.email::text solicitado_por
    from public.pedidos_online p
    left join public.cancelamentos_comanda c on c.pedido_id=p.id and c.estado='pendente'
    left join auth.users u on u.id=c.solicitado_por
    where p.empresa_id=p_empresa and p.mesa is not null and p.estado<>'recusado'
      and exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid())
      and (c.id is not null or not public.comanda_protegida(p))
      and (btrim(p_busca)='' or p.comanda::text=btrim(p_busca) or p.mesa::text=btrim(p_busca))
    order by (c.id is not null) desc,p.comanda limit 80
  ) q;
$$;

create function public.cancelamentos_recentes_kds(p_empresa uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.horario desc),'[]'::jsonb) from (
    select p.comanda,p.mesa,c.resolvido_em horario from public.cancelamentos_comanda c
    join public.pedidos_online p on p.id=c.pedido_id
    where p.empresa_id=p_empresa and c.estado='cancelado' and c.resolvido_em>=now()-interval '24 hours'
      and public.pode_operar_cozinha(p_empresa)
    order by c.resolvido_em desc limit 30
  ) q;
$$;

create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
    f.item || jsonb_build_object('edita_comanda',public.pode_editar_comanda_kds(p_empresa),
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
  where p.estado<>'recusado';
$$;

create or replace function public.proteger_andamento_ajuste()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.estado is distinct from old.estado and public.ajuste_comanda_pendente(old.id) then
    raise exception 'Aguarde a resolução do ajuste da comanda.';
  end if;
  if new.estado='entregue' and old.estado<>'entregue' and old.mesa is null and exists (
    select 1 from public.adicionais_comanda where pedido_id=old.id and estado<>'entregue'
  ) then raise exception 'Conclua os adicionais antes de entregar.'; end if;
  if new.estado='recusado' and old.estado<>'recusado' and exists (
    select 1 from public.adicionais_comanda where pedido_id=old.id and estado in ('novo','preparo','pronto')
  ) then raise exception 'A comanda ainda tem adicionais em andamento.'; end if;
  return new;
end;
$$;

create or replace function public.avancar_pedido(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pedido public.pedidos_online;
begin
  select p.* into v_pedido from public.pedidos_online p
  where p.id = p_id and public.pode_operar_cozinha(p.empresa_id)
  for update;
  if not found then raise exception 'Pedido indisponível.'; end if;
  if (v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null) and v_pedido.pix_sandbox_confirmado_em is null then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is null) then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if p_estado = 'entregue' and v_pedido.mesa is null and v_pedido.pix_sandbox_confirmado_em is null and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is not null) and not exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Registre o recebimento antes de entregar.'; end if;
  if p_estado = 'recusado' and v_pedido.mesa is not null then
    raise exception 'Cancele a comanda de mesa pelo caixa.';
  end if;
  if p_estado = 'recusado' and (v_pedido.pix_sandbox_confirmado_em is not null or exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id) or exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  )) then raise exception 'Confira o pagamento antes de recusar.'; end if;
  update public.pedidos_online p set estado = p_estado where p.id = p_id
    and ((p.estado = 'novo' and p_estado in ('preparo', 'recusado'))
      or (p.estado = 'preparo' and p_estado = 'pronto')
      or (p.estado = 'pronto' and p_estado = 'entregue'));
  if not found then raise exception 'Transição inválida.'; end if;
end;
$$;

create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'cancelado', exists(select 1 from public.cancelamentos_comanda c where c.pedido_id=p.id and c.estado='cancelado'), 'mesa', p.mesa, 'comanda', p.comanda, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or coalesce(pg.ambiente = 'sandbox', false),
    'pago', v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null,
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null, 'pix_producao', coalesce(pg.ambiente = 'producao', false))
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
  left join public.pagamentos_online pg on pg.pedido_id = p.id where e.cardapio_slug = p_slug and p.id = p_id;
$$;

create or replace function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos, p.itens, exists(select 1 from public.adicionais_comanda a where a.pedido_id=p.id and a.estado<>'entregue') as adicionais_pendentes,
      public.ajuste_comanda_pendente(p.id) as ajuste_pendente, public.cancelamento_comanda_pendente(p.id) as cancelamento_pendente
    from public.pedidos_online p
    where p.empresa_id = p_empresa and p.mesa is not null and p.estado = 'entregue'
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and not exists (select 1 from public.vendas v where v.id = p.id and v.empresa_id = p_empresa)
      and not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null
      and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id = p.id)
      and (btrim(p_busca) = '' or p.mesa::text = btrim(p_busca) or p.comanda::text = btrim(p_busca))
    order by p.comanda limit 100
  ) c;
$$;

revoke execute on function public.cancelamento_comanda_pendente(uuid),public.comanda_teve_preparo(public.pedidos_online),
  public.efetivar_cancelamento_comanda(public.pedidos_online,uuid) from public,anon,authenticated;
revoke execute on function public.solicitar_cancelamento_comanda(uuid,uuid,uuid,text),
  public.resolver_cancelamento_comanda(uuid,uuid,boolean,text),public.comandas_para_cancelar(uuid,text),
  public.cancelamentos_recentes_kds(uuid) from public,anon;
grant execute on function public.solicitar_cancelamento_comanda(uuid,uuid,uuid,text),
  public.resolver_cancelamento_comanda(uuid,uuid,boolean,text),public.comandas_para_cancelar(uuid,text),
  public.cancelamentos_recentes_kds(uuid) to authenticated;

commit;
