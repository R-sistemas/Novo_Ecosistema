begin;

create function painel_privado.responder_convite(p_token text,p_acao text,p_finalidade text)
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
    where c.finalidade=p_finalidade and c.segredo=sha256(convert_to(p_token,'UTF8'));
  if not found then raise insufficient_privilege; end if;
  if p_finalidade='equipe' then
    if not exists (select 1 from painel_privado.convites_equipe_ativacao a
      where a.empresa_id=convite.empresa_id and a.habilitado for share) then raise insufficient_privilege; end if;
  elsif not exists (select 1 from painel_privado.central_onboarding_ativacao
    where singleton and modo='ativo' for share) then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(convite.empresa_id::text||':'||convite.email,96));
  select c.* into convite from painel_privado.convites_equipe c
    where c.id=convite.id and c.finalidade=p_finalidade and c.segredo=sha256(convert_to(p_token,'UTF8')) for update;
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
    'emissor',case when p_finalidade='primeiro_gestor' then 'Central R Sistemas' else
      (select u.email from auth.users u where u.id=convite.emissor) end,
    'perfil',convite.perfil,'caixa',convite.caixa,'estado',convite.estado
  );
  if convite.estado='aceito' then
    if not (case when convite.perfil in ('vendas','gestor') then exists (
      select 1 from public.membros m where m.empresa_id=convite.empresa_id and m.usuario_id=ator
        and (p_finalidade='equipe' or m.papel='gestor')
    ) else exists (
      select 1 from public.equipe_kds k where k.empresa_id=convite.empresa_id and k.usuario_id=ator
    ) end) then raise insufficient_privilege; end if;
    return resumo;
  end if;
  if p_finalidade='primeiro_gestor' then
    perform 1 from painel_privado.vinculos_centrais v
      join painel_privado.capacidades_por_papel p on p.papel=v.papel
      where v.usuario_id=convite.emissor and p.capacidade='central.empresas.gerir' for share of v,p;
  else
    perform 1 from public.membros m where m.empresa_id=convite.empresa_id and m.usuario_id=convite.emissor
      and m.papel='gestor' for share;
  end if;
  if not found then raise insufficient_privilege; end if;
  if p_acao='consultar' then return resumo; end if;

  if p_acao='aceitar' then
    perform pg_advisory_xact_lock(hashtextextended(convite.empresa_id::text||':'||ator::text,97));
    if p_finalidade='primeiro_gestor' then
      update painel_privado.central_onboarding
        set gestor_id=ator where requisicao=convite.onboarding_requisicao
          and empresa_id=convite.empresa_id and origem='convite' and gestor_id is null;
      if not found then raise insufficient_privilege; end if;
      insert into public.membros(empresa_id,usuario_id,papel) values (convite.empresa_id,ator,'gestor');
    elsif convite.perfil='vendas' then
      perform public.vincular_novo_operador_pdv(convite.emissor,convite.empresa_id,ator,convite.caixa);
    else
      perform public.vincular_novo_usuario_kds(convite.emissor,convite.empresa_id,ator);
    end if;
  end if;
  update painel_privado.convites_equipe c
    set estado=case when p_acao='aceitar' then 'aceito' else 'recusado' end,
      aceito_por=case when p_acao='aceitar' then ator end,concluido_em=now()
    where c.id=convite.id and c.finalidade=p_finalidade;
  if p_finalidade='primeiro_gestor' then
    perform painel_privado.auditar_convite_primeiro_gestor(ator,convite,p_acao);
  else
    perform painel_privado.auditar_convite_equipe(ator,convite.empresa_id,convite.id,p_acao,convite.id);
  end if;
  return resumo||jsonb_build_object('estado',case when p_acao='aceitar' then 'aceito' else 'recusado' end);
end;
$$;

create or replace function public.responder_convite_equipe(p_token text,p_acao text)
returns jsonb language sql security definer set search_path = '' as $$
  select painel_privado.responder_convite(p_token,p_acao,'equipe');
$$;

create function public.responder_convite_primeiro_gestor(p_token text,p_acao text)
returns jsonb language sql security definer set search_path = '' as $$
  select painel_privado.responder_convite(p_token,p_acao,'primeiro_gestor');
$$;

create function public.central_convite_primeiro_gestor(p_empresa uuid,p_acao text,p_requisicao uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ator uuid;
  convite painel_privado.convites_equipe;
  anterior painel_privado.convites_equipe_requisicoes;
  dados jsonb := jsonb_build_object('empresa',p_empresa,'acao',p_acao,'finalidade','primeiro_gestor');
  token text;
  historico jsonb;
begin
  if p_acao='listar' then
    perform painel_privado.central_autor('central.empresas.ler');
    select c.* into convite from painel_privado.convites_equipe c
      where c.empresa_id=p_empresa and c.finalidade='primeiro_gestor';
    if not found then return jsonb_build_object('convite',null); end if;
    select coalesce(jsonb_agg(jsonb_build_object('acao',a.acao,'em',a.ocorrido_em,'geracao',a.depois->'geracao')
      order by a.ocorrido_em,a.id),'[]'::jsonb) into historico
      from painel_privado.auditoria a where a.empresa_id=p_empresa
        and a.entidade='convite_gestor' and a.entidade_id=convite.id::text;
    return jsonb_build_object('convite',jsonb_build_object('estado',case
      when convite.estado='pendente' and convite.expira_em<=now() then 'expirado' else convite.estado end,
      'email',convite.email,'geracao',convite.geracao,'historico',historico,'reenvio_habilitado',
      exists(select 1 from painel_privado.central_onboarding_ativacao where singleton and modo='ativo')));
  end if;
  ator := painel_privado.central_autor('central.empresas.gerir');
  if p_acao is distinct from 'reenviar' or p_requisicao is null then raise sqlstate '22023'; end if;
  if not exists (select 1 from painel_privado.central_onboarding_ativacao
    where singleton and modo='ativo' for share) then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(ator::text||':'||p_requisicao::text,95));
  select * into anterior from painel_privado.convites_equipe_requisicoes where emissor=ator and requisicao=p_requisicao;
  if found then
    if anterior.dados<>dados then raise unique_violation; end if;
    return jsonb_build_object('geracao',anterior.geracao);
  end if;
  select c.* into convite from painel_privado.convites_equipe c
    where c.empresa_id=p_empresa and c.finalidade='primeiro_gestor' for update;
  if not found or convite.estado not in ('pendente','expirado') then raise unique_violation; end if;
  token := painel_privado.gerar_segredo_convite();
  update painel_privado.convites_equipe c
    set estado='pendente', geracao=c.geracao+1, emissor=ator, concluido_em=null,
      expira_em=now()+interval '48 hours', segredo=sha256(convert_to(token,'UTF8'))
    where c.id=convite.id returning * into convite;
  insert into painel_privado.convites_equipe_requisicoes values (ator,p_requisicao,dados,convite.id,convite.geracao);
  perform painel_privado.auditar_convite_primeiro_gestor(ator,convite,'reenviar');
  return jsonb_build_object('geracao',convite.geracao,'token',token);
end;
$$;

revoke all on function painel_privado.responder_convite(text,text,text),
  public.responder_convite_primeiro_gestor(text,text),
  public.central_convite_primeiro_gestor(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.responder_convite_primeiro_gestor(text,text),
  public.central_convite_primeiro_gestor(uuid,text,uuid) to authenticated;

commit;
