begin;

-- Entregas e cancelamentos são vinculados pelo UUID do pedido já escopado à empresa.
create function painel_privado.financeiro_transacoes(p_empresa uuid, p_inicio date, p_fim date)
returns table (pedido_id uuid, referencia text, confirmado_em timestamptz, meio text, provedor text,
  canal text, estado text, valor_centavos bigint, frete_centavos bigint, taxa_centavos bigint, liquido_centavos bigint)
language plpgsql stable set search_path = '' as $$
begin
  if public.painel_contexto_sessao(p_empresa)->>'escopo' is distinct from 'loja' then
    raise insufficient_privilege;
  end if;
  if p_inicio is null or p_fim is null or not isfinite(p_inicio) or not isfinite(p_fim)
    or p_inicio < date '0001-01-01' or p_fim > date '9999-12-31' or p_fim - p_inicio not between 0 and 365 then
    raise invalid_parameter_value using message = 'Período inválido';
  end if;

  return query
  select p.id, coalesce(p.comanda::text, p.id::text), pg.confirmado_em, pg.meio, pg.provedor,
    case when d.pedido_id is not null or r.estado is not null then 'entrega' else 'cardapio' end,
    case when exists (
        select 1 from public.cancelamentos_comanda c where c.pedido_id = p.id and c.estado = 'cancelado'
      ) then 'cancelado'
      when r.estado = 'entregue' then 'entregue'
      when p.estado in ('novo', 'preparo', 'pronto') then 'pago'
      else p.estado end,
    pg.valor_centavos, coalesce(d.frete_centavos, 0)::bigint, null::bigint, null::bigint
  from public.pagamentos_online pg
  join public.pedidos_online p on p.id = pg.pedido_id and p.empresa_id = p_empresa
  left join public.entregas_pedido d on d.pedido_id = p.id
  left join lateral (
    select s.estado from remo.solicitacoes s
    where s.origem = 'r_sistemas' and s.ambiente = 'producao'
      and s.solicitante = p_empresa and s.referencia = p.id::text
    order by s.criada_em desc, s.id desc limit 1
  ) r on true
  where pg.empresa_id = p_empresa and pg.ambiente = 'producao'
    and pg.confirmado_em >= (p_inicio::timestamp at time zone 'America/Sao_Paulo')
    and pg.confirmado_em < ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo');
end;
$$;

create function public.painel_financeiro_resumo(p_empresa uuid, p_inicio date, p_fim date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as materialized (
    select * from painel_privado.financeiro_transacoes(p_empresa, p_inicio, p_fim)
  ), meios as (
    select meio as chave, sum(valor_centavos)::bigint as total from base group by meio
  ), provedores as (
    select provedor as chave, sum(valor_centavos)::bigint as total from base group by provedor
  ), canais as (
    select canal as chave, sum(valor_centavos)::bigint as total from base group by canal
  ), dias as (
    select (confirmado_em at time zone 'America/Sao_Paulo')::date as dia,
      sum(valor_centavos)::bigint as total from base group by 1
  )
  select jsonb_build_object(
    'quantidade', count(*),
    'total_centavos', coalesce(sum(valor_centavos)::bigint, 0)::text,
    'frete_centavos', coalesce(sum(frete_centavos)::bigint, 0)::text,
    'taxa_centavos', null::bigint, 'liquido_centavos', null::bigint,
    'meios', coalesce((select jsonb_object_agg(chave, total::text) from meios), '{}'),
    'provedores', coalesce((select jsonb_object_agg(chave, total::text) from provedores), '{}'),
    'canais', jsonb_build_object('pdv', '0'::text) || coalesce((select jsonb_object_agg(chave, total::text) from canais), '{}'),
    'dias', (
      select jsonb_agg(jsonb_build_object('dia', p_inicio + n,
        'total_centavos', coalesce(d.total, 0)::text) order by n)
      from generate_series(0, p_fim - p_inicio) as serie(n)
      left join dias d on d.dia = p_inicio + n
    )
  ) from base;
$$;

create function public.painel_financeiro_extrato(
  p_empresa uuid, p_inicio date, p_fim date, p_pagina integer, p_tamanho integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_pagina is null or p_pagina < 1 or p_tamanho is null or p_tamanho not between 1 and 100 then
    raise invalid_parameter_value using message = 'Paginação inválida';
  end if;
  return (with candidatos as (
    select * from painel_privado.financeiro_transacoes(p_empresa, p_inicio, p_fim)
    order by confirmado_em desc, pedido_id desc
    offset (p_pagina::bigint - 1) * p_tamanho limit p_tamanho + 1
  ), pagina as (
    select pedido_id, referencia, confirmado_em, meio, provedor, canal, estado,
      valor_centavos::text, frete_centavos::text, taxa_centavos::text, liquido_centavos::text
    from candidatos order by confirmado_em desc, pedido_id desc limit p_tamanho
  )
  select jsonb_build_object(
    'pagina', p_pagina, 'tem_proxima', (select count(*) from candidatos) > p_tamanho,
    'transacoes', coalesce((select jsonb_agg(to_jsonb(p) order by confirmado_em desc, pedido_id desc)
      from pagina p), '[]')
  ));
end;
$$;

revoke all on function painel_privado.financeiro_transacoes(uuid,date,date) from public,anon,authenticated,service_role;
revoke all on function public.painel_financeiro_resumo(uuid,date,date) from public,anon,authenticated,service_role;
revoke all on function public.painel_financeiro_extrato(uuid,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.painel_financeiro_resumo(uuid,date,date) to authenticated;
grant execute on function public.painel_financeiro_extrato(uuid,date,date,integer,integer) to authenticated;

commit;
