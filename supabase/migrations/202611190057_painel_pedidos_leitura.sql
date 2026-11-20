begin;

create index pedidos_online_painel_cursor
  on public.pedidos_online (empresa_id, criado_em desc, id desc);

create view painel_privado.pedidos_leitura as
select p.empresa_id, p.id, p.criado_em, p.cliente, p.mesa, p.comanda, p.itens,
  p.estado as estado_kds,
  case when c.pedido_id is not null then 'cancelado' else p.estado end as estado,
  case when e.pedido_id is null then 'cardapio' else 'entrega' end as origem,
  p.total_centavos - coalesce(e.frete_centavos, 0) as mercadoria_centavos,
  coalesce(e.frete_centavos, 0) as frete_centavos,
  v.desconto_centavos,
  coalesce(v.total_centavos, p.total_centavos) as total_centavos,
  case when v.id is not null or pg.confirmado_em is not null or p.pix_sandbox_confirmado_em is not null then 'confirmado'
    when pg.pedido_id is not null or p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null then 'pendente'
    when e.pagamento = 'na_entrega' then 'na_entrega' else 'sem_confirmacao' end as pagamento_estado,
  coalesce(v.meio, pg.meio, case when p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null
    or p.pix_sandbox_confirmado_em is not null then 'pix' end) as pagamento_meio,
  r.ordem_remo, r.estado as estado_entrega, e.pagamento as pagamento_entrega,
  jsonb_build_object('logradouro',e.endereco->>'logradouro','numero',e.endereco->>'numero',
    'bairro',e.endereco->>'bairro','complemento',e.endereco->>'complemento',
    'cidade',e.endereco->>'cidade','uf',e.endereco->>'uf',
    'cep',e.endereco->>'cep','telefone',e.endereco->>'telefone') as endereco
from public.pedidos_online p
left join public.entregas_pedido e on e.pedido_id = p.id
left join public.pagamentos_online pg on pg.pedido_id = p.id and pg.empresa_id = p.empresa_id
left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
left join public.cancelamentos_comanda c on c.pedido_id = p.id and c.estado = 'cancelado'
left join remo.solicitacoes r on r.origem = 'r_sistemas'
  and r.solicitante = p.empresa_id and r.referencia = p.id::text;

revoke all on painel_privado.pedidos_leitura from public, anon, authenticated, service_role;

create function public.painel_listar_pedidos(
  p_empresa uuid, p_inicio timestamptz default null, p_fim timestamptz default null,
  p_estado text default null, p_origem text default null, p_cursor_data timestamptz default null,
  p_cursor_id uuid default null, p_limite integer default 25
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  contexto jsonb := public.painel_contexto_sessao(p_empresa);
begin
  if contexto->>'escopo' is distinct from 'loja' then
    raise insufficient_privilege using message = 'Acesso negado';
  end if;
  if p_limite is null or p_limite not between 1 and 50
    or (p_inicio is not null and not isfinite(p_inicio))
    or (p_fim is not null and not isfinite(p_fim))
    or p_inicio >= p_fim
    or p_estado not in ('novo','preparo','pronto','entregue','recusado','cancelado')
    or p_origem not in ('cardapio','entrega')
    or (p_cursor_data is null) <> (p_cursor_id is null)
    or (p_cursor_data is not null and not isfinite(p_cursor_data)) then
    raise invalid_parameter_value using message = 'Filtros inválidos';
  end if;

  return (with candidatos as (
    select p.id,p.criado_em,p.cliente,p.comanda,p.origem,p.estado,p.estado_kds,p.estado_entrega,
      p.pagamento_estado,p.pagamento_meio,p.total_centavos,p.itens
    from painel_privado.pedidos_leitura p
    where p.empresa_id = (contexto->>'empresa_id')::uuid
      and (p_inicio is null or p.criado_em >= p_inicio)
      and (p_fim is null or p.criado_em < p_fim)
      and (p_estado is null or p.estado = p_estado)
      and (p_origem is null or p.origem = p_origem)
      and (p_cursor_id is null or (p.criado_em,p.id) < (p_cursor_data,p_cursor_id))
    order by p.criado_em desc,p.id desc
    limit p_limite + 1
  ), pagina as (
    select id, criado_em, cliente, comanda, origem, estado, estado_kds, estado_entrega,
      pagamento_estado, pagamento_meio, total_centavos,
      jsonb_array_length(itens) as linhas_itens,
      coalesce((select jsonb_agg(jsonb_build_object('nome',i.valor->>'nome','quantidade',i.valor->'quantidade') order by i.pos)
        from jsonb_array_elements(itens) with ordinality i(valor,pos) where i.pos <= 3), '[]') as resumo
    from candidatos order by criado_em desc,id desc limit p_limite
  )
  select jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(to_jsonb(p) order by p.criado_em desc,p.id desc) from pagina p),'[]'),
    'proximo_cursor', case when (select count(*) from candidatos) > p_limite then
      (select jsonb_build_object('data',criado_em,'id',id) from pagina order by criado_em,id limit 1) end));
end;
$$;

create function public.painel_detalhe_pedido(p_empresa uuid, p_pedido uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  contexto jsonb := public.painel_contexto_sessao(p_empresa);
  resultado jsonb;
begin
  if contexto->>'escopo' is distinct from 'loja' then
    raise insufficient_privilege using message = 'Acesso negado';
  end if;
  select to_jsonb(p) - 'empresa_id' - 'endereco' ||
    jsonb_build_object('endereco',case when p.origem = 'entrega' then jsonb_strip_nulls(p.endereco) end)
  into resultado from painel_privado.pedidos_leitura p
  where p.id = p_pedido and p.empresa_id = (contexto->>'empresa_id')::uuid;
  if resultado is null then
    raise sqlstate 'PT404' using message = 'Pedido indisponível';
  end if;
  return resultado;
end;
$$;

revoke all on function public.painel_listar_pedidos(uuid,timestamptz,timestamptz,text,text,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.painel_detalhe_pedido(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.painel_listar_pedidos(uuid,timestamptz,timestamptz,text,text,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.painel_detalhe_pedido(uuid,uuid) to authenticated;

commit;
