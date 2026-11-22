begin;

create table painel_privado.central_suspensoes (
  empresa_id uuid primary key references public.empresas(id),
  modo text not null check (modo in ('automatico', 'liberada', 'suspensa')),
  revisao integer not null check (revisao > 0)
);
alter table painel_privado.central_suspensoes enable row level security;
revoke all on painel_privado.central_suspensoes from public, anon, authenticated, service_role;

create unique index central_suspensao_requisicao on painel_privado.auditoria(requisicao_id)
  where escopo = 'plataforma' and acao = 'central.alterar_suspensao';

create function painel_privado.situacao_licenca(p_vencimento date, p_pagamento text, p_hoje date, p_modo text)
returns table(dias_em_atraso integer, automatico text, efetivo text)
language sql immutable set search_path = '' as $$
  with atraso as (
    select case when p_vencimento is null then null when p_pagamento = 'pago' then 0
      else greatest(p_hoje - p_vencimento, 0) end dias
  ), estado as (
    select dias, case when dias >= 5 then 'bloqueada_total'
      when dias = 4 then 'bloqueada_parcial' when dias > 0 then 'em_debito' else 'em_dia' end nivel
    from atraso
  )
  select dias, nivel, case p_modo when 'suspensa' then 'bloqueada_total'
    when 'liberada' then case when dias > 0 then 'em_debito' else 'em_dia' end else nivel end
  from estado;
$$;

create function painel_privado.situacao_empresa(p_empresa uuid)
returns table(dias_em_atraso integer, automatico text, efetivo text, modo text, revisao integer)
language sql stable set search_path = '' as $$
  select st.*, coalesce(s.modo,'automatico'), coalesce(s.revisao,0)
  from (select p_empresa id) e
  left join painel_privado.central_licencas l on l.empresa_id=e.id
  left join painel_privado.central_suspensoes s on s.empresa_id=e.id
  cross join lateral painel_privado.situacao_licenca(l.vencimento,l.pagamento,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,s.modo) st;
$$;

create function public.central_alterar_suspensao(p_empresa uuid, p_modo text, p_revisao integer,
  p_motivo text, p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  autor uuid := painel_privado.central_autor('central.empresas.gerir');
  anterior painel_privado.central_suspensoes;
  evento painel_privado.auditoria;
  depois jsonb;
  motivo text := btrim(p_motivo);
begin
  if p_empresa is null or p_requisicao is null or p_revisao is null or p_revisao not between 0 and 2147483646
    or p_modo is null or p_modo not in ('automatico','liberada','suspensa')
    or motivo is null or length(motivo) not between 1 and 240 then
    raise exception using errcode='22023', message='Suspensão inválida';
  end if;
  perform 1 from public.empresas where id=p_empresa for update;
  if not found then raise exception using errcode='P0002',message='Empresa inexistente'; end if;
  depois := jsonb_build_object('empresa_id',p_empresa,'modo',p_modo,'revisao',p_revisao+1);
  select * into evento from painel_privado.auditoria a
    where a.escopo='plataforma' and a.acao='central.alterar_suspensao' and a.requisicao_id=p_requisicao;
  if found then
    if evento.autor_id=autor and evento.entidade_id=p_empresa::text
      and evento.depois=depois and evento.motivo=motivo then return evento.depois; end if;
    raise exception using errcode='23505',message='Requisição já utilizada';
  end if;
  select * into anterior from painel_privado.central_suspensoes where empresa_id=p_empresa;
  if coalesce(anterior.revisao,0) <> p_revisao then
    raise exception using errcode='23505',message='Suspensão atualizada em outra sessão';
  end if;
  insert into painel_privado.central_suspensoes(empresa_id,modo,revisao) values(p_empresa,p_modo,p_revisao+1)
    on conflict (empresa_id) do update set modo=excluded.modo,revisao=excluded.revisao;
  insert into painel_privado.auditoria(autor_id,escopo,empresa_id,acao,entidade,entidade_id,antes,depois,motivo,requisicao_id)
    values(autor,'plataforma',null,'central.alterar_suspensao','empresa',p_empresa::text,
      case when anterior.revisao is not null then to_jsonb(anterior) end,depois,motivo,p_requisicao);
  return depois;
end;
$$;

create function painel_privado.central_listar_licencas(p_busca text, p_pagina integer, p_limite integer, p_atencao boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_busca text := lower(btrim(coalesce(p_busca,'')));
  resultado jsonb;
begin
  perform painel_privado.central_autor('central.empresas.ler');
  if length(v_busca)>120 or p_pagina is null or p_pagina not between 1 and 100000
    or p_limite is null or p_limite not between 1 and 100 then
    raise exception using errcode='22023',message='Consulta inválida';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.nome,r.id),'[]'::jsonb) into resultado
  from (
    select e.id,e.nome,e.cardapio_slug,coalesce(l.estado,'sem_classificacao') estado,
      l.plano,l.preco_centavos,l.vencimento,coalesce(l.pagamento,'pendente') pagamento,
      st.dias_em_atraso,coalesce(l.revisao,0) revisao,st.automatico situacao_automatica,
      st.efetivo situacao,coalesce(s.modo,'automatico') modo_suspensao,coalesce(s.revisao,0) revisao_suspensao
    from public.empresas e
    left join painel_privado.central_licencas l on l.empresa_id=e.id
    left join painel_privado.central_suspensoes s on s.empresa_id=e.id
    cross join lateral painel_privado.situacao_licenca(l.vencimento,l.pagamento,
      (statement_timestamp() at time zone 'America/Sao_Paulo')::date,s.modo) st
    where (v_busca='' or strpos(lower(e.nome),v_busca)>0 or strpos(lower(e.cardapio_slug),v_busca)>0)
      and (not p_atencao or st.efetivo<>'em_dia' or st.automatico<>'em_dia')
    order by e.nome,e.id offset ((p_pagina-1)*p_limite) limit (p_limite+1)
  ) r;
  return jsonb_build_object('empresas',case when jsonb_array_length(resultado)>p_limite
    then resultado-p_limite else resultado end,'tem_proxima',jsonb_array_length(resultado)>p_limite);
end;
$$;

create or replace function public.central_empresas(p_busca text,p_pagina integer,p_limite integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select painel_privado.central_listar_licencas(p_busca,p_pagina,p_limite,false);
$$;
create function public.central_empresas_atencao(p_busca text,p_pagina integer,p_limite integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select painel_privado.central_listar_licencas(p_busca,p_pagina,p_limite,true);
$$;

revoke all on function painel_privado.situacao_licenca(date,text,date,text),
  painel_privado.situacao_empresa(uuid), painel_privado.central_listar_licencas(text,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.central_empresas_atencao(text,integer,integer),
  public.central_alterar_suspensao(uuid,text,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.central_empresas_atencao(text,integer,integer),
  public.central_alterar_suspensao(uuid,text,integer,text,uuid) to authenticated;

commit;
