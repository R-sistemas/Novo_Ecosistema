begin;

create table public.pagamentos_online (
  pedido_id uuid primary key references public.pedidos_online(id),
  empresa_id uuid not null,
  provedor text not null,
  ambiente text not null default 'producao' check (ambiente = 'producao'),
  meio text not null check (meio in ('pix','credito','debito')),
  valor_centavos bigint not null check (valor_centavos > 0),
  cobranca_id text,
  confirmado_em timestamptz,
  foreign key (empresa_id, provedor, ambiente) references public.provedores_pagamento,
  unique (empresa_id, provedor, cobranca_id),
  check (confirmado_em is null or cobranca_id is not null)
);

alter table public.pagamentos_online enable row level security;
revoke all on public.pagamentos_online from public, anon, authenticated;
grant select, insert, update on public.pagamentos_online to service_role;

create function public.reservar_pix_quiosque(p_id uuid,p_cliente text,p_mesa uuid,p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_empresa uuid;
  v_pagamento public.pagamentos_online;
  v_criar boolean;
begin
  select e.id into strict v_empresa from public.empresas e
    join public.provedores_pagamento c on c.empresa_id=e.id
    where e.cardapio_slug='quiosque-dorafa' and c.provedor='asaas'
      and c.ambiente='producao' and c.pix_habilitado;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 2));
  select * into v_pagamento from public.pagamentos_online
    where pedido_id=p_id and empresa_id=v_empresa and provedor='asaas' and meio='pix';
  v_criar := not found;
  if v_criar then
    if exists(select 1 from public.pedidos_online where id=p_id) then
      raise exception 'Pedido já registrado.';
    end if;
    perform public.enviar_pedido('quiosque-dorafa',p_id,p_cliente,p_mesa,p_itens);
    insert into public.pagamentos_online(pedido_id,empresa_id,provedor,meio,valor_centavos)
      select id,empresa_id,'asaas','pix',total_centavos from public.pedidos_online where id=p_id
      returning * into v_pagamento;
  end if;
  return jsonb_build_object('criar',v_criar,'total_centavos',v_pagamento.valor_centavos,
    'cobranca',v_pagamento.cobranca_id,'confirmado',v_pagamento.confirmado_em is not null);
end;
$$;

create function public.atualizar_pix_quiosque(p_pedido uuid,p_cobranca text,p_valor bigint,p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online p
    set cobranca_id=p_cobranca,
        confirmado_em=case when p_confirmado then coalesce(p.confirmado_em,now()) else p.confirmado_em end
  from public.empresas e
  where e.id=p.empresa_id and e.cardapio_slug='quiosque-dorafa'
    and p.pedido_id=p_pedido and p.provedor='asaas' and p.meio='pix'
    and p.valor_centavos=p_valor and (p.cobranca_id is null or p.cobranca_id=p_cobranca);
  return found;
end;
$$;

create function public.pix_online_disponivel(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.empresas e join public.provedores_pagamento p on p.empresa_id=e.id
    where e.cardapio_slug=p_slug and p.provedor='asaas' and p.ambiente='producao' and p.pix_habilitado
  );
$$;

revoke execute on function public.reservar_pix_quiosque(uuid,text,uuid,jsonb),
  public.atualizar_pix_quiosque(uuid,text,bigint,boolean), public.pix_online_disponivel(text)
  from public, anon, authenticated;
grant execute on function public.reservar_pix_quiosque(uuid,text,uuid,jsonb),
  public.atualizar_pix_quiosque(uuid,text,bigint,boolean) to service_role;
grant execute on function public.pix_online_disponivel(text) to anon, authenticated;

create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null,
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null, 'pix_producao', pg.pedido_id is not null)
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  left join public.pagamentos_online pg on pg.pedido_id = p.id where e.cardapio_slug = p_slug and p.id = p_id;
$$;

create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.itens, p.total_centavos, p.estado, p.criado_em,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null) as recebido, p.pix_sandbox_confirmado_em is not null as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    left join public.pagamentos_online pg on pg.pedido_id = p.id
    where p.empresa_id = p_empresa and (pg.pedido_id is null or pg.confirmado_em is not null)
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and (p.estado in ('novo','preparo','pronto')
        or (p.estado = 'entregue' and v.id is null and p.pix_sandbox_confirmado_em is null and pg.confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;

create or replace function public.avancar_pedido(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pedido public.pedidos_online;
begin
  select p.* into v_pedido from public.pedidos_online p
  where p.id = p_id and exists (select 1 from public.membros m
    where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid())
  for update;
  if not found then raise exception 'Pedido indisponível.'; end if;
  if (v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null) and v_pedido.pix_sandbox_confirmado_em is null then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is null) then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if p_estado = 'entregue' and v_pedido.pix_sandbox_confirmado_em is null and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is not null) and not exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Registre o recebimento antes de entregar.'; end if;
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

create or replace function public.receber_pedido_no_caixa(p_caixa uuid, p_pedido uuid, p_meio text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_pedido public.pedidos_online;
  v_total bigint;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  select * into v_pedido from public.pedidos_online
  where id = p_pedido and empresa_id = v_caixa.empresa_id
  for update;
  if not found or v_pedido.estado = 'recusado' then
    raise exception 'Pedido indisponível.';
  end if;
  if v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null then raise exception 'Pedido vinculado ao Pix Sandbox.'; end if;
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_pedido) then raise exception 'Pedido com pagamento online.'; end if;
  v_total := public.registrar_venda(p_caixa, p_pedido, p_meio, v_pedido.itens);
  if v_total is distinct from v_pedido.total_centavos or exists (
    select 1 from jsonb_to_recordset(v_pedido.itens)
      as item(produto_id uuid, preco_centavos bigint)
    join public.itens_venda v on v.venda_id = p_pedido and v.produto_id = item.produto_id
    where v.preco_centavos <> item.preco_centavos
  ) then
    raise exception 'O preço do catálogo mudou. Confira o pedido antes de receber.';
  end if;
  return v_total;
end;
$$;

commit;
