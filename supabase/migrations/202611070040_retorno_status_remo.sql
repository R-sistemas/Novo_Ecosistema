begin;

-- A REMO continua como fonte do estado de entrega.

create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'estado_remo', r.estado, 'cancelado', exists(select 1 from public.cancelamentos_comanda c where c.pedido_id=p.id and c.estado='cancelado'), 'mesa', p.mesa, 'comanda', p.comanda, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or coalesce(pg.ambiente = 'sandbox', false),
    'pago', v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null,
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null, 'pix_producao', coalesce(pg.ambiente = 'producao', false))
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  left join remo.solicitacoes r on r.origem = 'r_sistemas' and r.solicitante = p.empresa_id and r.referencia = p.id::text
  left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
  left join public.pagamentos_online pg on pg.pedido_id = p.id where e.cardapio_slug = p_slug and p.id = p_id;
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
  if p_estado = 'entregue' and exists (select 1 from public.entregas_pedido where pedido_id=p_id) then
    raise exception 'A conclusão desta entrega é registrada na central REMO.';
  end if;
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

create or replace function public.fila_cozinha_original(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(case when exists (select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()) then to_jsonb(fila) else to_jsonb(fila) - array['endereco_entrega','total_centavos'] end order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.comanda, (case when exists (select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()) then p.itens else (select jsonb_agg(i - array['preco_centavos','produto_id']) from jsonb_array_elements(p.itens) i) end) as itens, p.total_centavos, case when r.estado = 'entregue' then 'entregue' else p.estado end as estado, r.estado as estado_remo, p.criado_em, d.pagamento as pagamento_entrega, d.endereco as endereco_entrega,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null) as recebido, (p.pix_sandbox_confirmado_em is not null or (pg.ambiente = 'sandbox' and pg.confirmado_em is not null)) is true as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    left join public.pagamentos_online pg on pg.pedido_id = p.id
    left join remo.solicitacoes r on r.origem = 'r_sistemas' and r.solicitante = p.empresa_id and r.referencia = p.id::text
    left join public.entregas_pedido d on d.pedido_id = p.id
    where p.empresa_id = p_empresa and (pg.pedido_id is null or pg.confirmado_em is not null)
      and public.pode_operar_cozinha(p_empresa)
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and ((p.estado in ('novo','preparo','pronto') and r.estado is distinct from 'entregue')
        or ((p.estado = 'entregue' or (r.estado = 'entregue' and exists (
          select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()
        ))) and p.mesa is null and v.id is null and p.pix_sandbox_confirmado_em is null and pg.confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;

create or replace function public.monitor_gestor(p_empresa uuid, p_dia date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inicio timestamptz := p_dia::timestamp at time zone 'America/Sao_Paulo';
  fim timestamptz := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not exists (
    select 1 from public.membros
    where usuario_id = auth.uid() and empresa_id = p_empresa and papel = 'gestor'
  ) then
    raise exception 'Acesso ao monitor indisponível para esta loja.' using errcode = '42501';
  end if;

  return (
    with pedidos as (
      select p.comanda, p.mesa, p.total_centavos, case when r.estado = 'entregue' then 'entregue' else p.estado end as estado, p.criado_em,
        case when r.id is not null then r.estado
          when e.pedido_id is not null then 'sem_despacho' end as entrega,
        case
          when p.pix_sandbox_confirmado_em is not null or (x.ambiente = 'sandbox' and x.estado = 'confirmado')
            or (pg.ambiente = 'sandbox' and pg.confirmado_em is not null) then 'teste'
          when v.id is not null or pg.confirmado_em is not null then 'recebido'
          when p.estado = 'recusado' then 'encerrado'
          when pg.pedido_id is not null or p.pix_sandbox_solicitado or e.pagamento = 'online'
            or x.estado in ('reservado', 'aguardando') then 'aguardando_online'
          when e.pagamento = 'na_entrega' then 'na_entrega'
          else 'no_caixa'
        end as pagamento
      from public.pedidos_online p
      left join public.entregas_pedido e on e.pedido_id = p.id
      left join remo.solicitacoes r on r.origem = 'r_sistemas'
        and r.solicitante = p.empresa_id and r.referencia = p.id::text
      left join public.pagamentos_online pg on pg.pedido_id = p.id and pg.empresa_id = p.empresa_id
      left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
      left join lateral (
        select x.ambiente, x.estado from public.pix_frente_caixa x
        where x.venda_id = p.id and x.pedido_id = p.id and x.estado in ('reservado', 'aguardando', 'confirmado')
        limit 1
      ) x on true
      where p.empresa_id = p_empresa and p.criado_em >= inicio and p.criado_em < fim
    ), recebimentos as (
      select v.meio, 'caixa'::text as origem, v.total_centavos as valor, v.criado_em as recebido_em, p.comanda
      from public.vendas v
      left join public.pedidos_online p on p.id = v.id and p.empresa_id = v.empresa_id
      where v.empresa_id = p_empresa and v.criado_em >= inicio and v.criado_em < fim
        and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id = v.id
          and pg.empresa_id = v.empresa_id and pg.confirmado_em is not null)
        and not exists (select 1 from public.pix_frente_caixa x where x.venda_id = v.id
          and x.estado = 'confirmado' and x.ambiente = 'sandbox')
        and p.pix_sandbox_confirmado_em is null
      union all
      select pg.meio, 'online', pg.valor_centavos, pg.confirmado_em, p.comanda
      from public.pagamentos_online pg
      join public.pedidos_online p on p.id = pg.pedido_id and p.empresa_id = pg.empresa_id
      where pg.empresa_id = p_empresa and pg.ambiente = 'producao' and pg.confirmado_em >= inicio and pg.confirmado_em < fim
    )
    select jsonb_build_object(
      'pedidos_total', (select count(*) from pedidos),
      'em_preparo', (select count(*) from pedidos where estado = 'preparo'),
      'em_rota', (select count(*) from pedidos where entrega = 'em_rota'),
      'entregues', (select count(*) from pedidos where entrega = 'entregue'),
      'entregas_total', (select count(*) from pedidos where entrega is not null),
      'recebimentos_total', (select count(*) from recebimentos),
      'recebido_caixa', (select coalesce(sum(valor), 0) from recebimentos where origem = 'caixa'),
      'recebido_online', (select coalesce(sum(valor), 0) from recebimentos where origem = 'online'),
      'pedidos', coalesce((select jsonb_agg(to_jsonb(p) order by p.criado_em desc, p.comanda desc)
        from (select * from pedidos order by criado_em desc, comanda desc limit 60) p), '[]'::jsonb),
      'entregas', coalesce((select jsonb_agg(to_jsonb(p) order by p.criado_em desc, p.comanda desc)
        from (select * from pedidos where entrega is not null order by criado_em desc, comanda desc limit 60) p), '[]'::jsonb),
      'recebimentos', coalesce((select jsonb_agg(to_jsonb(r) order by r.recebido_em desc)
        from (select * from recebimentos order by recebido_em desc limit 60) r), '[]'::jsonb)
    )
  );
end;
$$;

commit;
