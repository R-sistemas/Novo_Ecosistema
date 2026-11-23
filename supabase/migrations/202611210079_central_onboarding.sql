begin;

create table painel_privado.central_onboarding (
  requisicao uuid primary key,
  empresa_id uuid not null unique references public.empresas(id),
  autor_id uuid not null,
  email text not null unique,
  dados jsonb not null,
  chave uuid not null unique default gen_random_uuid(),
  gestor_id uuid unique references auth.users(id)
);
alter table painel_privado.central_onboarding enable row level security;
revoke all on painel_privado.central_onboarding from public, anon, authenticated, service_role;

create function public.central_criar_empresa(
  p_nome text, p_slug text, p_email text, p_plano text, p_preco integer,
  p_vencimento date, p_pagamento text, p_requisicao uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := painel_privado.central_autor('central.empresas.gerir');
  v_nome text := btrim(p_nome);
  v_email text := lower(btrim(p_email));
  v_id uuid;
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
  perform pg_advisory_xact_lock(hashtextextended(p_requisicao::text, 79));
  v_dados := jsonb_build_object('nome',v_nome,'slug',p_slug,'plano',p_plano,'preco_centavos',p_preco,
    'vencimento',p_vencimento,'pagamento',p_pagamento,'revisao',1);
  select * into v_solicitacao from painel_privado.central_onboarding where requisicao = p_requisicao;
  if found then
    if v_solicitacao.autor_id = v_autor and v_solicitacao.email = v_email and v_solicitacao.dados = v_dados then
      return v_solicitacao.empresa_id;
    end if;
    raise exception using errcode = '23505', message = 'Requisição já utilizada';
  end if;
  select * into v_solicitacao from painel_privado.central_onboarding where email = v_email;
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

create function public.central_dados_convite(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email',email,'chave',chave,'vinculado',gestor_id is not null)
  from painel_privado.central_onboarding where empresa_id = p_empresa;
$$;

create function painel_privado.central_vincular_gestor_convidado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_solicitacao painel_privado.central_onboarding;
begin
  if new.invited_at is null or new.raw_user_meta_data->>'rs_convite' is null then
    return new;
  end if;
  update painel_privado.central_onboarding
    set gestor_id = new.id
    where email = lower(new.email) and chave::text = new.raw_user_meta_data->>'rs_convite' and gestor_id is null
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

create function public.central_gestor_convidado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from painel_privado.central_onboarding o
    join public.membros m on m.empresa_id = o.empresa_id and m.usuario_id = o.gestor_id
    where o.gestor_id = auth.uid() and m.papel = 'gestor');
$$;
revoke all on function public.central_gestor_convidado() from public, anon, authenticated, service_role;
grant execute on function public.central_gestor_convidado() to authenticated;

create trigger central_vincular_gestor_convidado after update of invited_at on auth.users
for each row execute function painel_privado.central_vincular_gestor_convidado();

revoke all on function public.central_criar_empresa(text,text,text,text,integer,date,text,uuid),
  public.central_dados_convite(uuid), painel_privado.central_vincular_gestor_convidado()
  from public, anon, authenticated, service_role;
grant execute on function public.central_criar_empresa(text,text,text,text,integer,date,text,uuid) to authenticated;
grant execute on function public.central_dados_convite(uuid) to service_role;

commit;
