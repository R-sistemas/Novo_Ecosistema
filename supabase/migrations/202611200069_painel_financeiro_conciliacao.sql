begin;

create function public.painel_financeiro_conciliacao(
  p_empresa uuid, p_inicio date, p_fim date, p_pagina integer default 1, p_tamanho integer default 25
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inicio timestamptz;
  fim timestamptz;
  confirmados bigint;
  valor_confirmado bigint;
begin
  -- A fonte existente verifica o vínculo de gestor e as datas.
  if p_inicio is not null and p_fim is not null and isfinite(p_inicio) and isfinite(p_fim)
    and p_inicio >= date '0001-01-01' and p_fim <= date '9999-12-31'
    and p_fim - p_inicio > 364 then
    raise invalid_parameter_value using message = 'A conciliação aceita até 365 dias';
  end if;
  if p_pagina is null or p_pagina < 1 or p_tamanho is null or p_tamanho not between 1 and 100 then
    raise invalid_parameter_value using message = 'Paginação inválida';
  end if;
  select count(*), coalesce(sum(t.valor_centavos)::bigint, 0)
    into confirmados, valor_confirmado
    from painel_privado.financeiro_transacoes(p_empresa,p_inicio,p_fim) t;
  inicio := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  fim := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';

  return (with pendentes as materialized (
    -- O schema registra a data do pedido, sem timestamp de geração da cobrança.
    select p.id pedido_id, coalesce(p.comanda::text,p.id::text) referencia,
      p.criado_em pedido_criado_em, pg.provedor, pg.meio, pg.valor_centavos::text
    from public.pedidos_online p
    join public.pagamentos_online pg on pg.pedido_id = p.id and pg.empresa_id = p_empresa
    where p.empresa_id = p_empresa and pg.ambiente = 'producao'
      and pg.confirmado_em is null and nullif(btrim(pg.cobranca_id),'') is not null
      and p.criado_em >= inicio and p.criado_em < fim
      and p.criado_em < now() - interval '15 minutes'
  ), pagina as (
    select * from pendentes order by pedido_criado_em desc, pedido_id desc
    offset (p_pagina::bigint - 1) * p_tamanho limit p_tamanho
  ), eventos as materialized (
    select e.provedor, e.cobranca_id, e.evento_id, e.ocorrido_em, e.estado, e.valor_centavos,
      coalesce(p.comanda::text,p.id::text) referencia,
      pg.valor_centavos valor_local, pg.confirmado_em is not null confirmado_local
    from painel_privado.financeiro_eventos_psp e
    join public.pagamentos_online pg on pg.empresa_id = p_empresa
      and pg.provedor = e.provedor and pg.cobranca_id = e.cobranca_id and pg.ambiente = e.ambiente
    join public.pedidos_online p on p.id = pg.pedido_id and p.empresa_id = p_empresa
    where e.empresa_id = p_empresa and e.ambiente = 'producao'
      and e.ocorrido_em >= inicio and e.ocorrido_em < fim
  ), ultimos as (
    select distinct on (provedor,cobranca_id) * from eventos
    order by provedor,cobranca_id,ocorrido_em desc,evento_id desc
  ), divergentes as materialized (
    select referencia, provedor, ocorrido_em, confirmado_local, estado estado_psp,
      valor_local::text valor_local_centavos, valor_centavos::text valor_psp_centavos
    from ultimos
    where (valor_centavos is not null and valor_centavos <> valor_local)
      or (estado <> 'desconhecido' and estado <> case when confirmado_local then 'confirmado' else 'pendente' end)
  ), reversoes as materialized (
    select distinct on (provedor,cobranca_id) referencia, provedor, ocorrido_em, estado estado_psp, evento_id
    from eventos where estado in ('cancelado','estornado','estorno_parcial')
    order by provedor,cobranca_id,ocorrido_em desc,evento_id desc
  ), totais as (
    select (select count(*) from eventos) eventos, (select count(*) from pendentes) pendentes
  )
  select jsonb_build_object(
    'confirmadas',confirmados, 'confirmadas_centavos',valor_confirmado::text,
    'eventos_webhook',t.eventos,
    'conciliadas',case when t.eventos > 0 then (
      select count(*) from ultimos where confirmado_local and estado = 'confirmado' and valor_centavos = valor_local) end,
    'divergencias',case when t.eventos > 0 then (select count(*) from divergentes) end,
    'estornos_cancelamentos',case when t.eventos > 0 then (select count(*) from reversoes) end,
    'divergencias_recentes',coalesce((select jsonb_agg(to_jsonb(d) order by ocorrido_em desc, provedor, referencia)
      from (select * from divergentes order by ocorrido_em desc, provedor, referencia limit 25) d),'[]'),
    'estornos_cancelamentos_recentes',coalesce((select jsonb_agg(to_jsonb(r) order by ocorrido_em desc, provedor, referencia)
      from (select referencia, provedor, ocorrido_em, estado_psp from reversoes
        order by ocorrido_em desc, provedor, referencia limit 25) r),'[]'),
    'pendentes_total',t.pendentes, 'minutos_pendencia',15, 'pagina',p_pagina,
    'tem_proxima',t.pendentes > p_pagina::bigint * p_tamanho,
    'pendentes',coalesce((select jsonb_agg(to_jsonb(p) order by pedido_criado_em desc,pedido_id desc)
      from pagina p),'[]')
  ) from totais t);
end;
$$;

revoke all on function public.painel_financeiro_conciliacao(uuid,date,date,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.painel_financeiro_conciliacao(uuid,date,date,integer,integer) to authenticated;

commit;
