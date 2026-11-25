begin;

alter table painel_privado.central_onboarding
  add column origem text not null default 'legado' check (origem in ('legado','convite')),
  drop constraint central_onboarding_email_key,
  drop constraint central_onboarding_gestor_id_key;

create table painel_privado.central_onboarding_ativacao (
  singleton boolean primary key default true check (singleton),
  modo text not null check (modo in ('legado','ativo','pausado'))
);
insert into painel_privado.central_onboarding_ativacao values (true,'legado');
alter table painel_privado.central_onboarding_ativacao enable row level security;
revoke all on painel_privado.central_onboarding_ativacao from public,anon,authenticated,service_role;

create function painel_privado.configurar_onboarding_multiempresa(p_ativo boolean)
returns void language sql set search_path = '' as $$
  update painel_privado.central_onboarding_ativacao
    set modo=case when p_ativo then 'ativo' else 'pausado' end
    where singleton and p_ativo is not null;
$$;

create function painel_privado.auditar_convite_primeiro_gestor(
  p_ator uuid,p_convite painel_privado.convites_equipe,p_acao text
) returns void language sql set search_path = '' as $$
  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
  values (p_ator,'usuario',case when p_acao in ('aceitar','recusar') then 'loja' else 'plataforma' end,
    p_convite.empresa_id,'central.convite_gestor.'||p_acao,'convite_gestor',p_convite.id::text,
    jsonb_build_object('geracao',p_convite.geracao),p_convite.onboarding_requisicao);
$$;

create function painel_privado.emitir_primeiro_gestor(p_requisicao uuid,p_ator uuid)
returns text language plpgsql set search_path = '' as $$
declare
  origem painel_privado.central_onboarding;
  convite painel_privado.convites_equipe;
  alvo uuid;
  token text := painel_privado.gerar_segredo_convite();
begin
  select * into strict origem from painel_privado.central_onboarding
    where requisicao=p_requisicao and central_onboarding.origem='convite' and gestor_id is null for update;
  select (array_agg(u.id))[1] into alvo from auth.users u where lower(u.email)=origem.email having count(*)=1;
  insert into painel_privado.convites_equipe
    (empresa_id,email,destinatario,emissor,perfil,segredo,finalidade,escopo_emissor,onboarding_requisicao)
    values (origem.empresa_id,origem.email,alvo,p_ator,'gestor',sha256(convert_to(token,'UTF8')),
      'primeiro_gestor','plataforma',p_requisicao) returning * into convite;
  perform painel_privado.auditar_convite_primeiro_gestor(p_ator,convite,'emitir');
  return token;
end;
$$;

create or replace function public.central_criar_empresa(
  p_nome text, p_slug text, p_email text, p_plano text, p_preco integer,
  p_vencimento date, p_pagamento text, p_requisicao uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := painel_privado.central_autor('central.empresas.gerir');
  v_nome text := btrim(p_nome);
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_modo text;
  v_dados jsonb;
  v_solicitacao painel_privado.central_onboarding;
begin
  if p_requisicao is null or v_nome is null or length(v_nome) not between 1 and 100
    or p_slug is null or length(p_slug) not between 1 and 63 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_plano is null or p_plano not in ('basico','pro') or p_preco is null or p_preco < 0
    or p_vencimento is null or p_vencimento not between date '1900-01-01' and date '9999-12-05'
    or extract(day from p_vencimento) <> 5
    or p_pagamento is null or p_pagamento not in ('pendente','pago') then
    raise exception using errcode = '22023', message = 'Cadastro inválido';
  end if;
  select modo into v_modo from painel_privado.central_onboarding_ativacao where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended(p_requisicao::text, 79));
  v_dados := jsonb_build_object('nome',v_nome,'slug',p_slug,'plano',p_plano,'preco_centavos',p_preco,
    'vencimento',p_vencimento,'pagamento',p_pagamento,'revisao',1);
  select * into v_solicitacao from painel_privado.central_onboarding where requisicao = p_requisicao;
  if found then
    if v_solicitacao.origem='legado' and v_solicitacao.autor_id = v_autor and v_solicitacao.email = v_email and v_solicitacao.dados = v_dados then
      return v_solicitacao.empresa_id;
    end if;
    raise exception using errcode = '23505', message = 'Requisição já utilizada';
  end if;
  if v_modo<>'legado' then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_email, 79));
  select * into v_solicitacao from painel_privado.central_onboarding where email = v_email and origem='legado';
  if found and v_solicitacao.autor_id = v_autor and v_solicitacao.dados = v_dados then
    return v_solicitacao.empresa_id;
  end if;
  if found or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception using errcode = '23505', message = 'E-mail já cadastrado';
  end if;
  insert into public.empresas (nome, cardapio_slug) values (v_nome, p_slug) returning id into v_id;
  insert into painel_privado.central_licencas (empresa_id, estado, plano, preco_centavos, vencimento, pagamento, revisao)
    values (v_id, 'ativa', p_plano, p_preco, p_vencimento, p_pagamento, 1);
  insert into painel_privado.central_onboarding (requisicao, empresa_id, autor_id, email, dados)
    values (p_requisicao, v_id, v_autor, v_email, v_dados);
  insert into painel_privado.auditoria (autor_id, escopo, acao, entidade, entidade_id, depois, motivo, requisicao_id)
    values (v_autor, 'plataforma','central.criar_empresa','empresa',v_id::text,v_dados,'Criação de empresa',p_requisicao);
  return v_id;
end;
$$;

create function public.central_provisionar_empresa(
  p_nome text, p_slug text, p_email text, p_plano text, p_preco integer,
  p_vencimento date, p_pagamento text, p_requisicao uuid
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
    or p_plano is null or p_plano not in ('basico','pro') or p_preco is null or p_preco < 0
    or p_vencimento is null or p_vencimento not between date '1900-01-01' and date '9999-12-05'
    or extract(day from p_vencimento) <> 5
    or p_pagamento is null or p_pagamento not in ('pendente','pago') then
    raise exception using errcode = '22023', message = 'Cadastro inválido';
  end if;
  select modo into v_modo from painel_privado.central_onboarding_ativacao where singleton for share;
  if v_modo='legado' then return jsonb_build_object('modo','legado'); end if;
  if v_modo<>'ativo' then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_requisicao::text, 79));
  v_dados := jsonb_build_object('nome',v_nome,'slug',p_slug,'plano',p_plano,'preco_centavos',p_preco,
    'vencimento',p_vencimento,'pagamento',p_pagamento,'revisao',1);
  select * into v_solicitacao from painel_privado.central_onboarding where requisicao = p_requisicao;
  if found then
    if v_solicitacao.autor_id = v_autor and v_solicitacao.email = v_email and v_solicitacao.dados = v_dados then
      return jsonb_build_object('empresa',v_solicitacao.empresa_id,'modo',v_solicitacao.origem);
    end if;
    raise exception using errcode = '23505', message = 'Requisição já utilizada';
  end if;
  insert into public.empresas (nome, cardapio_slug) values (v_nome, p_slug) returning id into v_id;
  insert into painel_privado.central_licencas (empresa_id, estado, plano, preco_centavos, vencimento, pagamento, revisao)
    values (v_id, 'ativa', p_plano, p_preco, p_vencimento, p_pagamento, 1);
  insert into painel_privado.central_onboarding (requisicao, empresa_id, autor_id, email, dados)
    values (p_requisicao, v_id, v_autor, v_email, v_dados);
  insert into painel_privado.auditoria (autor_id, escopo, acao, entidade, entidade_id, depois, motivo, requisicao_id)
    values (v_autor, 'plataforma','central.criar_empresa','empresa',v_id::text,v_dados,'Criação de empresa',p_requisicao);
  return jsonb_build_object('empresa',v_id,'modo','convite','token',v_token);
end;
$$;

create or replace function painel_privado.central_vincular_gestor_convidado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_solicitacao painel_privado.central_onboarding;
begin
  if new.invited_at is null or new.raw_user_meta_data->>'rs_convite' is null then
    return new;
  end if;
  update painel_privado.central_onboarding
    set gestor_id = new.id
    where origem='legado' and email = lower(new.email) and chave::text = new.raw_user_meta_data->>'rs_convite' and gestor_id is null
    returning * into v_solicitacao;
  if found then
    insert into public.membros (empresa_id, usuario_id, papel)
      values (v_solicitacao.empresa_id, new.id, 'gestor');
    insert into painel_privado.auditoria (autor_id, escopo, acao, entidade, entidade_id, depois, motivo, requisicao_id)
      values (v_solicitacao.autor_id,'plataforma','central.vincular_gestor','empresa',
        v_solicitacao.empresa_id::text,jsonb_build_object('gestor_id',new.id),
        'Vínculo do gestor convidado',v_solicitacao.requisicao);
  end if;
  return new;
end;
$$;

create or replace function public.central_dados_convite(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email',email,'chave',chave,'vinculado',gestor_id is not null)
  from painel_privado.central_onboarding where empresa_id = p_empresa and origem='legado';
$$;

create or replace function public.central_gestor_convidado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from painel_privado.central_onboarding o
    join public.membros m on m.empresa_id = o.empresa_id and m.usuario_id = o.gestor_id
    where o.origem='legado' and o.gestor_id = auth.uid() and m.papel = 'gestor');
$$;

revoke all on function painel_privado.configurar_onboarding_multiempresa(boolean),
  painel_privado.auditar_convite_primeiro_gestor(uuid,painel_privado.convites_equipe,text),
  painel_privado.emitir_primeiro_gestor(uuid,uuid),
  public.central_provisionar_empresa(text,text,text,text,integer,date,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.central_provisionar_empresa(text,text,text,text,integer,date,text,uuid) to authenticated;

commit;
