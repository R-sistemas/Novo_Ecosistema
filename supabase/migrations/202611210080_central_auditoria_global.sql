begin;

create index central_auditoria_global_ordem
  on painel_privado.auditoria (ocorrido_em desc, id desc)
  where escopo = 'plataforma' and acao like 'central.%';

create function public.central_auditoria_global(
  p_acao text default null, p_empresa text default null, p_autor text default null,
  p_inicio date default null, p_fim date default null,
  p_cursor_em timestamptz default null, p_cursor_id uuid default null, p_limite integer default 20
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_resultado jsonb;
begin
  perform painel_privado.central_autor('central.empresas.ler');
  if p_limite is null or p_limite not between 1 and 100
    or (p_acao is not null and p_acao !~ '^central[.][a-z0-9_.]{1,80}$')
    or length(p_empresa) > 120 or length(p_autor) > 254
    or p_inicio > p_fim
    or p_inicio not between date '1900-01-01' and date '9999-12-31'
    or p_fim not between date '1900-01-01' and date '9999-12-31'
    or (p_cursor_em is null) <> (p_cursor_id is null)
    or not isfinite(coalesce(p_cursor_em, statement_timestamp())) then
    raise exception using errcode = '22023', message = 'Filtros inválidos';
  end if;

  select coalesce(jsonb_agg(to_jsonb(evento) order by ocorrido_em desc,id desc), '[]'::jsonb)
  into v_resultado
  from (
    select a.id, a.ocorrido_em, a.acao, coalesce(m.rotulo,'Ação central') as acao_rotulo,
      e.nome as empresa, case when a.origem_autor = 'usuario' then u.email end as autor,
      case when m.rotulo is not null then a.motivo end as motivo,
      resumo.antes, resumo.depois
    from painel_privado.auditoria a
    left join public.empresas e on e.id = case
      when a.entidade = 'empresa' and a.entidade_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then a.entidade_id::uuid end
    left join auth.users u on u.id = a.autor_id and a.origem_autor = 'usuario'
    left join (values
      ('central.editar_licenca','Editar licença',array['estado','plano','preco_centavos','vencimento','pagamento','revisao']),
      ('central.registrar_pagamento','Registrar pagamento',array['vencimento','pagamento','revisao','vencimento_quitado','data_pagamento','valor_centavos']),
      ('central.alterar_suspensao','Alterar suspensão',array['modo','revisao']),
      ('central.criar_empresa','Criar empresa',array['nome','slug','plano','preco_centavos','vencimento','pagamento','revisao']),
      ('central.vincular_gestor','Vincular gestor',array[]::text[]),
      ('central.conceder_primeiro_papel','Conceder primeiro papel',array['papel']),
      ('central.revogar_primeiro_papel','Revogar primeiro papel',array['papel'])
    ) m(acao,rotulo,campos) on m.acao = a.acao
    cross join lateral (
      select
        (select jsonb_object_agg(k,a.antes->k) from unnest(m.campos) k
          where jsonb_typeof(a.antes->k) in ('string','number','boolean','null')) as antes,
        (select jsonb_object_agg(k,a.depois->k) from unnest(m.campos) k
          where jsonb_typeof(a.depois->k) in ('string','number','boolean','null')) as depois
    ) resumo
    where a.escopo = 'plataforma' and a.acao like 'central.%'
      and (p_acao is null or a.acao = p_acao)
      and (nullif(btrim(p_empresa),'') is null or strpos(lower(e.nome),lower(btrim(p_empresa))) > 0)
      and (nullif(btrim(p_autor),'') is null or strpos(lower(u.email),lower(btrim(p_autor))) > 0)
      and (p_inicio is null or a.ocorrido_em >= (p_inicio::timestamp at time zone 'America/Sao_Paulo'))
      and (p_fim is null or a.ocorrido_em < ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo'))
      and (p_cursor_em is null or (a.ocorrido_em,a.id) < (p_cursor_em,p_cursor_id))
    order by a.ocorrido_em desc,a.id desc limit (p_limite + 1)
  ) evento;
  return jsonb_build_object('eventos', case when jsonb_array_length(v_resultado) > p_limite
    then v_resultado - p_limite else v_resultado end, 'tem_proxima', jsonb_array_length(v_resultado) > p_limite);
end;
$$;

revoke all on function public.central_auditoria_global(text,text,text,date,date,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.central_auditoria_global(text,text,text,date,date,timestamptz,uuid,integer)
  to authenticated;

commit;
