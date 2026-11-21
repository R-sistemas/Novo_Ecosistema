begin;

create function painel_privado.financeiro_reversoes(p_empresa uuid,p_inicio date,p_fim date)
returns jsonb language sql stable set search_path = '' as $$
  with limites as (
    select p_inicio::timestamp at time zone 'America/Sao_Paulo' inicio,
      (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo' fim
  ), eventos as (
    select e.*, max(e.estornado_centavos) over (
      partition by e.provedor,e.cobranca_id order by e.ocorrido_em,e.estornado_centavos nulls last,e.evento_id
      rows between unbounded preceding and 1 preceding
    ) anterior_no_periodo
    from painel_privado.financeiro_eventos_psp e
    cross join limites l
    where e.empresa_id=p_empresa and e.ambiente='producao' and e.ocorrido_em>=l.inicio and e.ocorrido_em<l.fim
  ), observacoes as (
    select e.provedor,e.cobranca_id,
      bool_or(e.estado in ('estornado','estorno_parcial') or coalesce(e.estornado_centavos,0)>0) estorno,
      bool_or(e.estornado_centavos<e.anterior_no_periodo) decrescente,
      bool_or(e.estado in ('estornado','estorno_parcial') and coalesce(e.estornado_centavos,0)=0) valor_ausente,
      bool_or(e.estado='cancelado') cancelamento,
      bool_or(e.estado='contestacao') contestacao,
      min(e.estornado_centavos) minimo,
      max(e.estornado_centavos) acumulado
    from eventos e
    join public.pagamentos_online pg on pg.empresa_id=p_empresa and pg.ambiente=e.ambiente
      and pg.provedor=e.provedor and pg.cobranca_id=e.cobranca_id
    group by e.provedor,e.cobranca_id
  ), diferencas as (
    select o.provedor,o.estorno,o.cancelamento,o.contestacao,
      case when not o.estorno then 0
        when not o.valor_ausente and not coalesce(o.decrescente,false) and o.minimo >= coalesce(anterior.estornado_centavos,0)
          and (anterior.estornado_centavos is not null or o.minimo=0)
        then o.acumulado-coalesce(anterior.estornado_centavos,0) end centavos
    from observacoes o cross join limites l
    left join lateral (
      select e.estornado_centavos
      from painel_privado.financeiro_eventos_psp e
      where e.empresa_id=p_empresa and e.ambiente='producao'
        and e.provedor=o.provedor and e.cobranca_id=o.cobranca_id and e.ocorrido_em<l.inicio
        and e.estornado_centavos is not null
      order by e.ocorrido_em desc,e.evento_id desc limit 1
    ) anterior on o.estorno
  ), grupos as (
    select provedor,grouping(provedor) geral,
      count(*) eventos_em_cobrancas,
      count(*) filter (where estorno) estornos,
      count(*) filter (where cancelamento) cancelamentos,
      count(*) filter (where contestacao) contestacoes,
      count(*) filter (where estorno and centavos is null) sem_valor,
      case when count(*)>0 and count(*) filter(where estorno and centavos is null)=0
        then sum(coalesce(centavos,0))::bigint::text end estornado_centavos
    from diferencas group by grouping sets ((provedor),())
  )
  select (to_jsonb(g)-'geral'-'provedor') || jsonb_build_object(
    'provedores',coalesce((select jsonb_object_agg(p.provedor,to_jsonb(p)-'geral'-'provedor') from grupos p where p.geral=0),'{}')
  ) from grupos g where g.geral=1;
$$;

create function painel_privado.financeiro_extrato_linhas(
  p_empresa uuid,p_inicio date,p_fim date,p_offset bigint,p_limite integer
)
returns table (pedido_id uuid,referencia text,confirmado_em timestamptz,meio text,provedor text,
  canal text,estado text,valor_centavos text,frete_centavos text,taxa_centavos text,liquido_centavos text,estado_psp text)
language sql stable set search_path = '' as $$
  with pagina as materialized (
    select * from painel_privado.financeiro_transacoes(p_empresa,p_inicio,p_fim)
    order by confirmado_em desc,pedido_id desc offset p_offset limit p_limite
  )
  select t.pedido_id,t.referencia,t.confirmado_em,t.meio,t.provedor,t.canal,t.estado,
    t.valor_centavos::text,t.frete_centavos::text,t.taxa_centavos::text,t.liquido_centavos::text,e.estado
  from pagina t
  join public.pagamentos_online pg on pg.empresa_id=p_empresa and pg.pedido_id=t.pedido_id and pg.ambiente='producao'
  left join lateral (
    select x.estado from painel_privado.financeiro_eventos_psp x
    where x.empresa_id=p_empresa and x.ambiente=pg.ambiente and x.provedor=pg.provedor and x.cobranca_id=pg.cobranca_id
      and x.ocorrido_em<((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
    order by x.ocorrido_em desc,x.evento_id desc limit 1
  ) e on true
  order by t.confirmado_em desc,t.pedido_id desc;
$$;

create or replace function public.painel_financeiro_extrato(
  p_empresa uuid,p_inicio date,p_fim date,p_pagina integer,p_tamanho integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_pagina is null or p_pagina < 1 or p_tamanho is null or p_tamanho not between 1 and 100 then
    raise invalid_parameter_value using message = 'Paginação inválida';
  end if;
  return (with candidatos as materialized (
    select * from painel_privado.financeiro_extrato_linhas(p_empresa,p_inicio,p_fim,
      (p_pagina::bigint-1)*p_tamanho,p_tamanho+1)
  ), pagina as (
    select * from candidatos order by confirmado_em desc,pedido_id desc limit p_tamanho
  )
  select jsonb_build_object('pagina',p_pagina,'tem_proxima',(select count(*) from candidatos)>p_tamanho,
    'transacoes',coalesce((select jsonb_agg(to_jsonb(p) order by confirmado_em desc,pedido_id desc) from pagina p),'[]')));
end;
$$;

create or replace function public.painel_financeiro_resumo(p_empresa uuid, p_inicio date, p_fim date)
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
    'reversoes', painel_privado.financeiro_reversoes(p_empresa,p_inicio,p_fim),
    'dias', (
      select jsonb_agg(jsonb_build_object('dia', p_inicio + n,
        'total_centavos', coalesce(d.total, 0)::text) order by n)
      from generate_series(0, p_fim - p_inicio) as serie(n)
      left join dias d on d.dia = p_inicio + n
    )
  ) from base;
$$;

create function public.painel_financeiro_exportar(p_empresa uuid,p_inicio date,p_fim date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when count(*)>5000 then jsonb_build_object('limite_excedido',true)
    else jsonb_build_object('transacoes',coalesce(
      jsonb_agg(to_jsonb(t) order by t.confirmado_em desc,t.pedido_id desc),'[]')) end
  from painel_privado.financeiro_extrato_linhas(p_empresa,p_inicio,p_fim,0,5001) t;
$$;

revoke all on function painel_privado.financeiro_reversoes(uuid,date,date),
  painel_privado.financeiro_extrato_linhas(uuid,date,date,bigint,integer),
  public.painel_financeiro_exportar(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.painel_financeiro_exportar(uuid,date,date) to authenticated;

commit;
