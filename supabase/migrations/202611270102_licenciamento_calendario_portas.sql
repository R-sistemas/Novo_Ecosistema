begin;

create function licenciamento_privado.cnpj_canonico(p_valor text)
returns text language plpgsql immutable strict set search_path = '' as $$
declare
  valor text := translate(upper(btrim(p_valor)), './-', '');
  pesos int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int;
  resto int;
begin
  if valor !~ '^[A-Z0-9]{12}[0-9]{2}$' or valor ~ '^([0-9])\1{13}$' then
    return null;
  end if;
  for etapa in 1..2 loop
    soma := 0;
    for i in 1..(11 + etapa) loop
      soma := soma + (ascii(substr(valor,i,1))-48) * pesos[i+2-etapa];
    end loop;
    resto := soma % 11;
    if substr(valor,12+etapa,1)::int <> (case when resto < 2 then 0 else 11-resto end) then
      return null;
    end if;
  end loop;
  return valor;
end;
$$;

create function licenciamento_privado.data_aniversario(p_base date,p_ancora smallint,p_meses integer)
returns date language sql immutable strict set search_path = '' as $$
  select destino::date + least(p_ancora::int,
    extract(day from destino + interval '1 month -1 day')::int) - 1
  from (select date_trunc('month',p_base::timestamp) + make_interval(months=>p_meses) destino) m
  where p_ancora between 1 and 31;
$$;

create function licenciamento_privado.estado_operacional(c licenciamento_privado.contratos, agora timestamptz)
returns text language sql stable strict set search_path = '' as $$
  select case
    when c.invalido_em <= agora or c.acesso_encerrado_em <= agora then 'restrita'
    when c.fase = 'trial' then case when agora < c.trial_fim then 'trial' else 'restrita' end
    when c.fase <> 'ativa' then 'restrita'
    when (agora at time zone 'America/Sao_Paulo')::date < c.valido_ate then 'valida'
    when c.nao_renovar then 'restrita'
    when (agora at time zone 'America/Sao_Paulo')::date < c.valido_ate + 5 then 'tolerancia'
    else 'restrita'
  end;
$$;

create or replace function painel_privado.situacao_empresa(p_empresa uuid)
returns table(dias_em_atraso integer, automatico text, efetivo text, modo text, revisao integer)
language sql stable set search_path = '' as $$
  with entrada as (
    select l.vencimento,l.pagamento,coalesce(s.modo,'automatico') modo,coalesce(s.revisao,0) revisao,
      c.politica,c.valido_ate,licenciamento_privado.estado_operacional(c,statement_timestamp()) novo,
      (statement_timestamp() at time zone 'America/Sao_Paulo')::date hoje
    from (select p_empresa id) e
    left join painel_privado.central_licencas l on l.empresa_id=e.id
    left join painel_privado.central_suspensoes s on s.empresa_id=e.id
    left join licenciamento_privado.contratos c on c.empresa_id=e.id
  )
  select st.*, e.modo, e.revisao
  from entrada e cross join lateral painel_privado.situacao_licenca(e.vencimento,e.pagamento,e.hoje,e.modo) st
  where e.politica is distinct from 'aniversario'
  union all
  select case when e.novo='tolerancia' or e.novo='restrita' then greatest(e.hoje-e.valido_ate,0) else 0 end,
    case e.novo when 'restrita' then 'bloqueada_total' when 'tolerancia' then 'em_debito' else 'em_dia' end,
    case when e.modo='suspensa' or e.novo='restrita' then 'bloqueada_total'
      when e.novo='tolerancia' then 'em_debito' else 'em_dia' end, e.modo, e.revisao
  from entrada e where e.politica='aniversario';
$$;

-- O provisionamento preexistente continua legado; esta operação explícita exige empresa já disponível.
create function public.central_iniciar_trial_licenca(p_empresa uuid,p_cnpj text,p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  autor uuid := painel_privado.central_autor('central.empresas.gerir');
  doc text := licenciamento_privado.cnpj_canonico(p_cnpj);
  agora timestamptz := statement_timestamp();
  atual licenciamento_privado.contratos;
  evento painel_privado.auditoria;
begin
  if p_requisicao is null or doc is null then raise exception using errcode='22023',message='CNPJ ou requisição inválida'; end if;
  if not exists(select 1 from licenciamento_privado.configuracao where admissao_ativa) then
    raise exception using errcode='42501',message='Admissão de licenças indisponível';
  end if;
  perform 1 from public.empresas where id=p_empresa for update;
  if not found then raise exception using errcode='P0002',message='Empresa inexistente'; end if;
  select * into evento from painel_privado.auditoria where escopo='plataforma'
    and acao='central.licenca_trial' and requisicao_id=p_requisicao;
  if found then
    if evento.autor_id=autor and evento.entidade_id=p_empresa::text and exists(
      select 1 from licenciamento_privado.empresas_fiscais where empresa_id=p_empresa and cnpj=doc)
    then return evento.depois; end if;
    raise exception using errcode='23505',message='Requisição já utilizada';
  end if;
  if exists(select 1 from licenciamento_privado.contratos where empresa_id=p_empresa)
    or exists(select 1 from painel_privado.central_licencas where empresa_id=p_empresa) then
    raise exception using errcode='23505',message='Empresa já possui licença';
  end if;
  insert into licenciamento_privado.empresas_fiscais(empresa_id,cnpj) values(p_empresa,doc);
  insert into licenciamento_privado.trials_usados values(doc,agora);
  insert into licenciamento_privado.contratos(empresa_id,politica,fase,trial_inicio,trial_fim)
    values(p_empresa,'aniversario','trial',agora,agora+interval '168 hours') returning * into atual;
  insert into painel_privado.auditoria(autor_id,escopo,acao,entidade,entidade_id,depois,requisicao_id)
    values(autor,'plataforma','central.licenca_trial','empresa',p_empresa::text,to_jsonb(atual),p_requisicao);
  return to_jsonb(atual);
end;
$$;
create unique index licenca_trial_requisicao on painel_privado.auditoria(requisicao_id)
  where escopo='plataforma' and acao='central.licenca_trial';

revoke all on all functions in schema licenciamento_privado from public, anon, authenticated, service_role;
revoke all on function public.central_iniciar_trial_licenca(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.central_iniciar_trial_licenca(uuid,text,uuid) to authenticated;

commit;
