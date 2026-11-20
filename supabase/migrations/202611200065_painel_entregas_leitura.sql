begin;

create function public.painel_entregas(p_empresa uuid,p_acao text,p_dados jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  contexto jsonb := public.painel_contexto_sessao(p_empresa);
  empresa uuid;
  inicio timestamptz;
  fim timestamptz;
  cursor_data timestamptz;
  cursor_id uuid;
  filtro_estado text;
  busca text;
  limite integer;
  resultado jsonb;
begin
  if contexto->>'escopo' is distinct from 'loja' then raise insufficient_privilege; end if;
  empresa := (contexto->>'empresa_id')::uuid;
  if p_acao = 'detalhe' then
    select jsonb_build_object(
      'id',r.id,'pedido_id',p.id,'comanda',p.comanda,'cliente',p.cliente,'estado_remo',r.estado,
      'estado_pedido',p.estado,'criado_em',r.criada_em,'total_centavos',p.total_centavos,
      'cobrar_na_entrega_centavos',r.cobrar_na_entrega_centavos,'itens',p.itens,
      'destino',nullif(jsonb_strip_nulls(p.endereco) || coalesce((
        select jsonb_object_agg(k,r.destino->>k) from jsonb_object_keys(p.endereco) k
        where jsonb_typeof(r.destino->k) in ('string','number')
      ),'{}'),'{}'))
    into resultado
    from remo.solicitacoes r
    join painel_privado.pedidos_leitura p on p.empresa_id=r.solicitante and p.id::text=r.referencia
    where r.solicitante=empresa and r.origem='r_sistemas' and r.ambiente='producao'
      and r.id=(p_dados->>'id')::uuid;
    if resultado is null then raise sqlstate 'PT404' using message='Entrega indisponível'; end if;
    return resultado;
  end if;
  if p_acao is distinct from 'listar' then raise invalid_parameter_value; end if;

  inicio := (p_dados->>'inicio')::timestamptz;
  fim := (p_dados->>'fim')::timestamptz;
  cursor_data := (p_dados->>'cursor_data')::timestamptz;
  cursor_id := (p_dados->>'cursor_id')::uuid;
  filtro_estado := p_dados->>'estado';
  busca := nullif(lower(btrim(p_dados->>'busca')),'');
  limite := coalesce((p_dados->>'limite')::integer,25);
  if limite not between 1 and 50 or inicio >= fim
    or (inicio is not null and not isfinite(inicio)) or (fim is not null and not isfinite(fim))
    or (cursor_data is null) <> (cursor_id is null) or (cursor_data is not null and not isfinite(cursor_data))
    or filtro_estado not in ('solicitada','aceita','em_rota','entregue','cancelada')
    or length(busca)>36 then
    raise invalid_parameter_value using message='Filtros inválidos';
  end if;
  return (with candidatos as (
    select r.id,p.id pedido_id,p.comanda,p.cliente,r.estado estado_remo,p.estado estado_pedido,
      r.cobrar_na_entrega_centavos,p.total_centavos,r.criada_em criado_em
    from remo.solicitacoes r
    join painel_privado.pedidos_leitura p on p.empresa_id=r.solicitante and p.id::text=r.referencia
    where r.solicitante=empresa and r.origem='r_sistemas' and r.ambiente='producao'
      and (inicio is null or r.criada_em>=inicio) and (fim is null or r.criada_em<fim)
      and (filtro_estado is null or r.estado=filtro_estado)
      and (busca is null or p.comanda::text=busca or left(p.id::text,length(busca))=busca)
      and (cursor_id is null or (r.criada_em,r.id)<(cursor_data,cursor_id))
    order by r.criada_em desc,r.id desc limit limite+1
  ), pagina as (
    select * from candidatos order by criado_em desc,id desc limit limite
  )
  select jsonb_build_object('entregas',coalesce((select jsonb_agg(to_jsonb(p) order by criado_em desc,id desc) from pagina p),'[]'),
    'proximo_cursor',case when (select count(*) from candidatos)>limite then
      (select jsonb_build_object('data',criado_em,'id',id) from pagina order by criado_em,id limit 1) end));
end;
$$;

revoke all on function public.painel_entregas(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.painel_entregas(uuid,text,jsonb) to authenticated;

commit;
