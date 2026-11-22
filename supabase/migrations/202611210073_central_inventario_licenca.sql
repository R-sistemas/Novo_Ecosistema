begin;

create table painel_privado.central_licencas (
  empresa_id uuid primary key references public.empresas(id),
  estado text not null check (estado in ('sem_classificacao', 'ativa')),
  plano text check (plano in ('basico', 'pro')),
  preco_centavos integer check (preco_centavos >= 0),
  vencimento date check (vencimento between date '1900-01-01' and date '9999-12-31'),
  pagamento text not null check (pagamento in ('pendente', 'pago')),
  revisao integer not null check (revisao > 0)
);
alter table painel_privado.central_licencas enable row level security;
revoke all on painel_privado.central_licencas from public, anon, authenticated, service_role;

insert into painel_privado.capacidades_centrais values ('central.empresas.ler'), ('central.empresas.gerir');
insert into painel_privado.capacidades_por_papel values
  ('central', 'central.empresas.ler'), ('central', 'central.empresas.gerir');

create unique index central_licenca_requisicao on painel_privado.auditoria(requisicao_id)
  where escopo = 'plataforma' and acao = 'central.editar_licenca';

create function painel_privado.central_autor(p_capacidade text)
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare
  v_contexto jsonb := public.painel_contexto_sessao(null::uuid);
begin
  if v_contexto->>'escopo' is distinct from 'central'
    or not coalesce((v_contexto->'capacidades') ? p_capacidade, false)
    or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception using errcode = '42501', message = 'Acesso negado';
  end if;
  return auth.uid();
end;
$$;
revoke all on function painel_privado.central_autor(text) from public, anon, authenticated, service_role;

create function public.central_empresas(p_busca text, p_pagina integer, p_limite integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_busca text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_busca, '')));
  v_resultado jsonb;
begin
  perform painel_privado.central_autor('central.empresas.ler');
  if pg_catalog.length(v_busca) > 120 or p_pagina is null or p_pagina not between 1 and 100000
    or p_limite is null or p_limite not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Consulta inválida';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.nome, r.id), '[]'::jsonb)
    into v_resultado
  from (
    select e.id, e.nome, e.cardapio_slug, coalesce(l.estado, 'sem_classificacao') as estado,
      l.plano, l.preco_centavos, l.vencimento, coalesce(l.pagamento, 'pendente') as pagamento,
      case when l.vencimento is null then null when l.pagamento = 'pago' then 0
        else greatest((pg_catalog.now() at time zone 'America/Sao_Paulo')::date - l.vencimento, 0)
      end as dias_em_atraso, coalesce(l.revisao, 0) as revisao
    from public.empresas e
    left join painel_privado.central_licencas l on l.empresa_id = e.id
    where v_busca = '' or pg_catalog.strpos(pg_catalog.lower(e.nome), v_busca) > 0
      or pg_catalog.strpos(pg_catalog.lower(e.cardapio_slug), v_busca) > 0
    order by e.nome, e.id
    offset ((p_pagina - 1) * p_limite) limit (p_limite + 1)
  ) r;
  return jsonb_build_object('empresas', case when jsonb_array_length(v_resultado) > p_limite
    then v_resultado - p_limite else v_resultado end,
    'tem_proxima', jsonb_array_length(v_resultado) > p_limite);
end;
$$;

create function public.central_editar_licenca(
  p_empresa uuid, p_revisao integer, p_estado text, p_plano text, p_preco_centavos integer,
  p_vencimento date, p_pagamento text, p_motivo text, p_requisicao uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := painel_privado.central_autor('central.empresas.gerir');
  v_anterior painel_privado.central_licencas;
  v_evento painel_privado.auditoria;
  v_depois jsonb;
  v_motivo text := pg_catalog.btrim(p_motivo);
begin
  if p_empresa is null or p_requisicao is null or p_revisao is null or p_revisao not between 0 and 2147483646
    or p_estado is null or p_estado not in ('sem_classificacao', 'ativa')
    or p_plano not in ('basico', 'pro') or p_preco_centavos < 0
    or p_vencimento not between date '1900-01-01' and date '9999-12-31'
    or p_pagamento is null or p_pagamento not in ('pendente', 'pago')
    or v_motivo is null or pg_catalog.length(v_motivo) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'Licença inválida';
  end if;
  perform 1 from public.empresas where id = p_empresa for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Empresa inexistente';
  end if;
  v_depois := jsonb_build_object('empresa_id', p_empresa, 'revisao', p_revisao + 1,
    'estado', p_estado, 'plano', p_plano, 'preco_centavos', p_preco_centavos,
    'vencimento', p_vencimento, 'pagamento', p_pagamento);
  select * into v_evento from painel_privado.auditoria
    where escopo = 'plataforma' and acao = 'central.editar_licenca' and requisicao_id = p_requisicao;
  if found then
    if v_evento.autor_id = v_autor and v_evento.entidade_id = p_empresa::text
      and v_evento.depois = v_depois and v_evento.motivo = v_motivo then
      return v_evento.depois;
    end if;
    raise exception using errcode = '23505', message = 'Requisição já utilizada';
  end if;
  select * into v_anterior from painel_privado.central_licencas where empresa_id = p_empresa;
  if coalesce(v_anterior.revisao, 0) <> p_revisao then
    raise exception using errcode = '23505', message = 'Licença atualizada em outra sessão';
  end if;
  insert into painel_privado.central_licencas values (
    p_empresa, p_estado, p_plano, p_preco_centavos, p_vencimento, p_pagamento, p_revisao + 1
  ) on conflict (empresa_id) do update set estado = excluded.estado, plano = excluded.plano,
    preco_centavos = excluded.preco_centavos, vencimento = excluded.vencimento,
    pagamento = excluded.pagamento, revisao = excluded.revisao;
  insert into painel_privado.auditoria
    (autor_id, escopo, empresa_id, acao, entidade, entidade_id, antes, depois, motivo, requisicao_id)
    values (v_autor, 'plataforma', null, 'central.editar_licenca', 'empresa', p_empresa::text,
      case when v_anterior.revisao is not null then to_jsonb(v_anterior) end,
      v_depois, v_motivo, p_requisicao);
  return v_depois;
end;
$$;

revoke all on function public.central_empresas(text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.central_editar_licenca(uuid, integer, text, text, integer, date, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.central_empresas(text, integer, integer) to authenticated;
grant execute on function public.central_editar_licenca(uuid, integer, text, text, integer, date, text, text, uuid)
  to authenticated;

commit;
