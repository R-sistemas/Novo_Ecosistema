begin;

alter table painel_privado.convites_equipe
  add column finalidade text not null default 'equipe',
  add column escopo_emissor text not null default 'loja',
  add column onboarding_requisicao uuid references painel_privado.central_onboarding(requisicao),
  drop constraint convites_equipe_perfil_check,
  add constraint convites_equipe_finalidade_perfil check (
    (finalidade='equipe' and perfil in ('vendas','cozinha') and escopo_emissor='loja' and onboarding_requisicao is null)
    or (finalidade='primeiro_gestor' and perfil='gestor' and escopo_emissor='plataforma' and onboarding_requisicao is not null and caixa is null)
    or (finalidade='gestor_adicional' and perfil='gestor' and escopo_emissor='plataforma' and onboarding_requisicao is null and caixa is null)
  ),
  add constraint convites_equipe_onboarding_unico unique(onboarding_requisicao);

drop index painel_privado.convites_equipe_pendente;
create unique index convites_equipe_pendente on painel_privado.convites_equipe(empresa_id,email,finalidade)
  where estado='pendente';

create function painel_privado.gerar_segredo_convite()
returns text language sql set search_path = '' as $$
  select replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
$$;
revoke all on function painel_privado.gerar_segredo_convite() from public,anon,authenticated,service_role;

create or replace function public.gerenciar_convites_equipe(p_empresa uuid,p_acao text,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ator uuid := auth.uid();
  email_alvo text := lower(btrim(p_dados->>'email'));
  perfil_alvo text := p_dados->>'perfil';
  caixa_alvo text := nullif(btrim(p_dados->>'caixa'),'');
  alvo uuid;
  convite painel_privado.convites_equipe;
  chave uuid;
  anterior painel_privado.convites_equipe_requisicoes;
  token text;
  ativo boolean;
  ativado boolean;
begin
  perform 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=ator
    and m.papel='gestor' for share;
  if not found then raise insufficient_privilege; end if;

  select a.habilitado,true into ativo,ativado from painel_privado.convites_equipe_ativacao a
    where a.empresa_id=p_empresa for share;

  if p_acao='listar' then
    return jsonb_build_object('habilitado',coalesce(ativo,false),'legado',not coalesce(ativado,false),'convites',
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'email',c.email,'perfil',c.perfil,'caixa',c.caixa,'expira_em',c.expira_em,
        'estado',case when c.estado='pendente' and c.expira_em<=now() then 'expirado' else c.estado end
      ) order by c.criado_em desc) from painel_privado.convites_equipe c where c.empresa_id=p_empresa and c.finalidade='equipe'),'[]'::jsonb));
  end if;

  if p_acao is null or p_acao not in ('emitir','reenviar','cancelar') then raise sqlstate '22023'; end if;
  if p_acao<>'cancelar' and ativo is distinct from true then raise insufficient_privilege; end if;
  chave := (p_dados->>'requisicao')::uuid;
  if chave is null then raise sqlstate '22023'; end if;
  p_dados := case when p_acao='emitir'
    then jsonb_build_object('email',email_alvo,'perfil',perfil_alvo,'caixa',caixa_alvo)
    else jsonb_build_object('id',(p_dados->>'id')::uuid) end;
  perform pg_advisory_xact_lock(hashtextextended(ator::text||':'||chave::text,95));
  select r.* into anterior from painel_privado.convites_equipe_requisicoes r
    where r.emissor=ator and r.requisicao=chave;
  if found then
    if anterior.dados <> jsonb_build_object('empresa',p_empresa,'acao',p_acao,'dados',p_dados)
      then raise unique_violation; end if;
    return jsonb_build_object('id',anterior.convite,'geracao',anterior.geracao);
  end if;

  if p_acao='emitir' then
    if email_alvo is null or length(email_alvo)>254 or email_alvo !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or perfil_alvo is null or perfil_alvo not in ('vendas','cozinha')
      or length(caixa_alvo)>60 or (perfil_alvo='cozinha' and caixa_alvo is not null)
      then raise sqlstate '22023'; end if;
  else
    select c.email into email_alvo from painel_privado.convites_equipe c
      where c.id=(p_dados->>'id')::uuid and c.empresa_id=p_empresa and c.finalidade='equipe';
    if not found then raise insufficient_privilege; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_empresa::text||':'||email_alvo,96));

  if p_acao='emitir' then
    select (array_agg(u.id))[1] into alvo from auth.users u where lower(u.email)=email_alvo having count(*)=1;
    update painel_privado.convites_equipe c set estado='expirado',concluido_em=now()
      where c.empresa_id=p_empresa and c.finalidade='equipe' and c.email=email_alvo and c.estado='pendente' and c.expira_em<=now();
  else
    select c.* into convite from painel_privado.convites_equipe c
      where c.id=(p_dados->>'id')::uuid and c.empresa_id=p_empresa and c.finalidade='equipe' for update;
    if convite.estado not in ('pendente','expirado') then raise unique_violation; end if;
  end if;

  if p_acao='cancelar' then
    update painel_privado.convites_equipe c set estado='cancelado',concluido_em=now()
      where c.id=convite.id and c.finalidade='equipe' returning * into convite;
  else
    token := painel_privado.gerar_segredo_convite();
    if p_acao='emitir' then
      insert into painel_privado.convites_equipe(empresa_id,email,destinatario,emissor,perfil,caixa,segredo)
        values (p_empresa,email_alvo,alvo,ator,perfil_alvo,caixa_alvo,sha256(convert_to(token,'UTF8')))
        returning * into convite;
    else
      update painel_privado.convites_equipe c
        set emissor=ator,segredo=sha256(convert_to(token,'UTF8')),geracao=c.geracao+1,
          expira_em=now()+interval '48 hours',estado='pendente',concluido_em=null
        where c.id=convite.id and c.finalidade='equipe' returning * into convite;
    end if;
  end if;

  insert into painel_privado.convites_equipe_requisicoes
    values (ator,chave,jsonb_build_object('empresa',p_empresa,'acao',p_acao,'dados',p_dados),convite.id,convite.geracao);
  perform painel_privado.auditar_convite_equipe(ator,p_empresa,convite.id,p_acao,chave);
  return jsonb_strip_nulls(jsonb_build_object('id',convite.id,'geracao',convite.geracao,'token',token));
end;
$$;

create or replace function public.responder_convite_equipe(p_token text,p_acao text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ator uuid := auth.uid();
  convite painel_privado.convites_equipe;
  email_ator text;
  resumo jsonb;
begin
  if ator is null or p_token is null or p_token !~ '^[0-9a-f]{64}$'
    or p_acao is null or p_acao not in ('consultar','aceitar','recusar') then raise insufficient_privilege; end if;

  select c.* into convite from painel_privado.convites_equipe c
    where c.finalidade='equipe' and c.segredo=sha256(convert_to(p_token,'UTF8'));
  if not found then raise insufficient_privilege; end if;
  if not exists (select 1 from painel_privado.convites_equipe_ativacao a
    where a.empresa_id=convite.empresa_id and a.habilitado for share) then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(convite.empresa_id::text||':'||convite.email,96));
  select c.* into convite from painel_privado.convites_equipe c
    where c.id=convite.id and c.finalidade='equipe' and c.segredo=sha256(convert_to(p_token,'UTF8')) for update;
  if not found then raise insufficient_privilege; end if;
  select lower(u.email) into email_ator from auth.users u where u.id=ator for share;
  if email_ator is distinct from convite.email or (convite.destinatario is not null and convite.destinatario<>ator)
    or (convite.destinatario is null and exists (
      select 1 from auth.users u where lower(u.email)=convite.email and u.id<>ator
    )) then raise insufficient_privilege; end if;
  if convite.estado not in ('pendente','aceito') or (convite.estado='pendente' and convite.expira_em<=now()) or
    (convite.estado='aceito' and convite.aceito_por is distinct from ator) then raise insufficient_privilege; end if;
  resumo := jsonb_build_object(
    'empresa_id',convite.empresa_id,'loja',(select e.nome from public.empresas e where e.id=convite.empresa_id),
    'emissor',(select u.email from auth.users u where u.id=convite.emissor),
    'perfil',convite.perfil,'caixa',convite.caixa,'estado',convite.estado
  );
  if convite.estado='aceito' then
    if not (case when convite.perfil='vendas' then exists (
      select 1 from public.membros m where m.empresa_id=convite.empresa_id and m.usuario_id=ator
    ) else exists (
      select 1 from public.equipe_kds k where k.empresa_id=convite.empresa_id and k.usuario_id=ator
    ) end) then raise insufficient_privilege; end if;
    return resumo;
  end if;
  perform 1 from public.membros m where m.empresa_id=convite.empresa_id and m.usuario_id=convite.emissor
    and m.papel='gestor' for share;
  if not found then raise insufficient_privilege; end if;
  if p_acao='consultar' then return resumo; end if;

  if p_acao='aceitar' then
    perform pg_advisory_xact_lock(hashtextextended(convite.empresa_id::text||':'||ator::text,97));
    if convite.perfil='vendas' then
      perform public.vincular_novo_operador_pdv(convite.emissor,convite.empresa_id,ator,convite.caixa);
    else
      perform public.vincular_novo_usuario_kds(convite.emissor,convite.empresa_id,ator);
    end if;
  end if;
  update painel_privado.convites_equipe c
    set estado=case when p_acao='aceitar' then 'aceito' else 'recusado' end,
      aceito_por=case when p_acao='aceitar' then ator end,concluido_em=now()
    where c.id=convite.id and c.finalidade='equipe';
  perform painel_privado.auditar_convite_equipe(ator,convite.empresa_id,convite.id,p_acao,convite.id);
  return resumo||jsonb_build_object('estado',case when p_acao='aceitar' then 'aceito' else 'recusado' end);
end;
$$;

create or replace function painel_privado.invalidar_convites_desligamento(p_empresa uuid,p_usuario uuid,p_email text)
returns void language sql set search_path = '' as $$
  update painel_privado.convites_equipe c
    set estado=case when c.estado='pendente' then 'cancelado' else c.estado end,
      concluido_em=case when c.estado='pendente' then now() else c.concluido_em end,
      segredo=sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8'))
    where c.finalidade='equipe' and c.empresa_id=p_empresa and (c.destinatario=p_usuario or c.email=p_email)
      and c.estado in ('pendente','aceito');
$$;

commit;
