begin;

create function public.painel_visao_geral(p_empresa uuid,p_inicio date,p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  contexto jsonb := public.painel_contexto_sessao(p_empresa);
  empresa uuid := (contexto->>'empresa_id')::uuid;
  inicio timestamptz;
  fim timestamptz;
begin
  if contexto->>'escopo' is distinct from 'loja' then
    raise insufficient_privilege using message = 'Acesso negado';
  end if;
  if p_inicio is null or p_fim is null or not isfinite(p_inicio) or not isfinite(p_fim)
    or p_inicio >= p_fim then
    raise invalid_parameter_value using message = 'Período inválido';
  end if;
  if p_fim - p_inicio > 366 then
    raise invalid_parameter_value using message = 'Período inválido';
  end if;
  inicio := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  fim := p_fim::timestamp at time zone 'America/Sao_Paulo';

  return (with pedidos as (
    select (p.criado_em at time zone 'America/Sao_Paulo')::date dia,
      case when c.pedido_id is not null then 'cancelado' else p.estado end estado,
      p.pagamento
    from painel_privado.monitor_pedidos p
    left join public.cancelamentos_comanda c on c.pedido_id=p.id and c.estado='cancelado'
    where p.empresa_id=empresa and p.criado_em>=inicio and p.criado_em<fim and not p.sandbox
  ), recebimentos as (
    select (r.recebido_em at time zone 'America/Sao_Paulo')::date dia, r.origem, r.canal, r.valor
    from painel_privado.monitor_recebimentos r
    where r.empresa_id=empresa and r.recebido_em>=inicio and r.recebido_em<fim
  ), pedidos_dia as (
    select dia,count(*) pedidos from pedidos group by dia
  ), recebido_dia as (
    select dia,count(*) recebimentos,sum(valor) receita_centavos from recebimentos group by dia
  ), estados as (
    select estado,count(*) total from pedidos group by estado
  ), canais as (
    select canal,sum(valor) total from recebimentos group by canal
  )
  select jsonb_build_object(
    'atualizado_em',statement_timestamp(),
    'pedidos_total',(select count(*) from pedidos),
    'por_estado',jsonb_build_object('novo',0,'preparo',0,'pronto',0,'entregue',0,'recusado',0,'cancelado',0)
      || coalesce((select jsonb_object_agg(estado,total) from estados),'{}'),
    'pendentes_online',(select count(*) from pedidos where estado<>'cancelado' and pagamento='aguardando_online'),
    'recebimentos_total',(select count(*) from recebimentos),
    'receita_centavos',(select coalesce(sum(valor),0) from recebimentos),
    'recebido_caixa',(select coalesce(sum(valor),0) from recebimentos where origem='caixa'),
    'recebido_online',(select coalesce(sum(valor),0) from recebimentos where origem='online'),
    'por_canal',jsonb_build_object('pix',0,'credito',0,'debito',0,'na_entrega',0,'dinheiro',0,'cartao',0)
      || coalesce((select jsonb_object_agg(canal,total) from canais),'{}'),
    'ticket_medio_centavos',(select round(avg(valor)) from recebimentos),
    'serie',(select jsonb_agg(jsonb_build_object('dia',p_inicio+n,
      'pedidos',coalesce(p.pedidos,0),'recebimentos',coalesce(r.recebimentos,0),
      'receita_centavos',coalesce(r.receita_centavos,0)) order by n)
      from generate_series(0,p_fim-p_inicio-1) n
      left join pedidos_dia p on p.dia=p_inicio+n
      left join recebido_dia r on r.dia=p_inicio+n)));
end;
$$;

revoke all on function public.painel_visao_geral(uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.painel_visao_geral(uuid,date,date) to authenticated;

commit;
