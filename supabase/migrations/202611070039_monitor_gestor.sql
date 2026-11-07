begin;

create index vendas_empresa_data on public.vendas (empresa_id, criado_em);
create index pagamentos_online_empresa_confirmacao on public.pagamentos_online (empresa_id, confirmado_em)
  where confirmado_em is not null;

create function public.monitor_gestor(p_empresa uuid, p_dia date)
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
      select p.comanda, p.mesa, p.total_centavos, p.estado, p.criado_em,
        case when r.id is not null then r.estado
          when e.pedido_id is not null then 'sem_despacho' end as entrega,
        case
          when p.pix_sandbox_confirmado_em is not null or x.ambiente = 'sandbox' then 'teste'
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
      where pg.empresa_id = p_empresa and pg.confirmado_em >= inicio and pg.confirmado_em < fim
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

revoke all on function public.monitor_gestor(uuid, date) from public, anon, authenticated;
grant execute on function public.monitor_gestor(uuid, date) to authenticated;

commit;
