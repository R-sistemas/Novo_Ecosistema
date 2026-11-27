begin;

create function licenciamento_privado.trial_disponivel()
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from licenciamento_privado.configuracao where admissao_ativa)
    and exists(select 1 from painel_privado.central_onboarding_ativacao where modo='ativo');
$$;

create function licenciamento_privado.provisionar_empresa(
  p_nome text, p_slug text, p_email text, p_plano text, p_preco integer,
  p_vencimento date, p_pagamento text, p_requisicao uuid,p_doc text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := painel_privado.central_autor('central.empresas.gerir');
  v_nome text := btrim(p_nome);
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_token text;
  v_modo text;
  v_dados jsonb;
  v_solicitacao painel_privado.central_onboarding;
begin
  if p_requisicao is null or v_nome is null or length(v_nome) not between 1 and 100
    or p_slug is null or length(p_slug) not between 1 and 63 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or (p_doc is null and (p_plano is null or p_plano not in ('basico','pro') or p_preco is null or p_preco < 0
    or p_vencimento is null or p_vencimento not between date '1900-01-01' and date '9999-12-05'
    or extract(day from p_vencimento) <> 5
    or p_pagamento is null or p_pagamento not in ('pendente','pago'))) then
    raise exception using errcode = '22023', message = 'Cadastro inválido';
  end if;
  select modo into v_modo from painel_privado.central_onboarding_ativacao where singleton for share;
  if p_doc is null and v_modo='legado' then return jsonb_build_object('modo','legado'); end if;
  if v_modo<>'ativo' or (p_doc is not null and not licenciamento_privado.trial_disponivel()) then
    raise insufficient_privilege;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_requisicao::text, 79));
  v_dados := jsonb_build_object('nome',v_nome,'slug',p_slug,'plano',p_plano,'preco_centavos',p_preco,
    'vencimento',p_vencimento,'pagamento',p_pagamento,'revisao',1);
  if p_doc is not null then
    v_dados := jsonb_build_object('nome',v_nome,'slug',p_slug,'licenciamento','trial','revisao',1);
  end if;
  select * into v_solicitacao from painel_privado.central_onboarding where requisicao = p_requisicao;
  if found then
    if v_solicitacao.autor_id = v_autor and v_solicitacao.email = v_email and v_solicitacao.dados = v_dados
      and (p_doc is null or exists(select 1 from licenciamento_privado.empresas_fiscais
        where empresa_id=v_solicitacao.empresa_id and cnpj=p_doc)) then
      return jsonb_build_object('empresa',v_solicitacao.empresa_id,'modo',v_solicitacao.origem);
    end if;
    raise exception using errcode = '23505', message = 'Requisição já utilizada';
  end if;
  insert into public.empresas (nome, cardapio_slug) values (v_nome, p_slug) returning id into v_id;
  if p_doc is not null then
    if exists(select 1 from licenciamento_privado.trials_usados where cnpj=p_doc) then
      raise exception using errcode='23505',message='Trial já utilizado';
    end if;
    insert into licenciamento_privado.empresas_fiscais(empresa_id,cnpj) values(v_id,p_doc);
    insert into licenciamento_privado.contratos(empresa_id,politica,fase)
      values(v_id,'aniversario','preparacao');
  else
    insert into painel_privado.central_licencas (empresa_id, estado, plano, preco_centavos, vencimento, pagamento, revisao)
      values (v_id, 'ativa', p_plano, p_preco, p_vencimento, p_pagamento, 1);
  end if;
  insert into painel_privado.central_onboarding (requisicao, empresa_id, autor_id, email, dados, origem)
    values (p_requisicao, v_id, v_autor, v_email, v_dados, 'convite');
  v_token := painel_privado.emitir_primeiro_gestor(p_requisicao,v_autor);
  insert into painel_privado.auditoria (autor_id, escopo, acao, entidade, entidade_id, depois, motivo, requisicao_id)
    values (v_autor, 'plataforma','central.criar_empresa','empresa',v_id::text,v_dados,'Criação de empresa',p_requisicao);
  return jsonb_build_object('empresa',v_id,'modo','convite','token',v_token);
end;
$$;

create or replace function public.central_provisionar_empresa(
  p_nome text,p_slug text,p_email text,p_plano text,p_preco integer,p_vencimento date,p_pagamento text,p_requisicao uuid
) returns jsonb language sql security definer set search_path = '' as $$
  select licenciamento_privado.provisionar_empresa(p_nome,p_slug,p_email,p_plano,p_preco,p_vencimento,
    p_pagamento,p_requisicao,null);
$$;

create function public.central_provisionar_empresa_trial(
  p_nome text,p_slug text,p_email text,p_cnpj text,p_requisicao uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare doc text := licenciamento_privado.cnpj_canonico(p_cnpj);
begin
  if doc is null then raise exception using errcode='22023',message='CNPJ inválido'; end if;
  return licenciamento_privado.provisionar_empresa(p_nome,p_slug,p_email,null,null,null,null,p_requisicao,doc);
end;
$$;

create function public.central_opcoes_onboarding_licenca()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform painel_privado.central_autor('central.empresas.gerir');
  return jsonb_build_object('trial',licenciamento_privado.trial_disponivel());
end;
$$;

create function licenciamento_privado.iniciar_trial_provisionado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  doc text;
  agora timestamptz := statement_timestamp();
  c licenciamento_privado.contratos;
begin
  select f.cnpj into doc from licenciamento_privado.empresas_fiscais f
  join licenciamento_privado.contratos t using(empresa_id)
  where t.empresa_id=new.empresa_id and t.politica='aniversario' and t.fase='preparacao';
  if not found then return new; end if;
  insert into licenciamento_privado.trials_usados values(doc,agora);
  update licenciamento_privado.contratos set fase='trial',trial_inicio=agora,trial_fim=agora+interval '168 hours',
    revisao=revisao+1 where empresa_id=new.empresa_id and fase='preparacao' returning * into strict c;
  insert into painel_privado.auditoria(autor_id,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
    values(new.gestor_id,'loja',new.empresa_id,'licenca.trial_inicio','empresa',new.empresa_id::text,to_jsonb(c),new.requisicao);
  return new;
end;
$$;

create trigger iniciar_trial_com_primeiro_gestor after update of gestor_id on painel_privado.central_onboarding
  for each row when (old.gestor_id is null and new.gestor_id is not null and new.origem='convite')
  execute function licenciamento_privado.iniciar_trial_provisionado();

create function licenciamento_privado.proteger_licenca_legada()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from licenciamento_privado.contratos where empresa_id=new.empresa_id and politica='aniversario') then
    raise exception using errcode='23505',message='Licença por validade não pode ser alterada pelo editor legado';
  end if;
  return new;
end;
$$;
create trigger licenca_legada_somente before insert or update on painel_privado.central_licencas for each row execute function licenciamento_privado.proteger_licenca_legada();

revoke all on all functions in schema licenciamento_privado from public,anon,authenticated,service_role;
revoke all on function public.central_provisionar_empresa_trial(text,text,text,text,uuid),
  public.central_opcoes_onboarding_licenca() from public,anon,authenticated,service_role;
grant execute on function public.central_provisionar_empresa_trial(text,text,text,text,uuid),
  public.central_opcoes_onboarding_licenca() to authenticated;

commit;
