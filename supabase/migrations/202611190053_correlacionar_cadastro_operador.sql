begin;

create unique index auditoria_cadastro_operador_etapa on painel_privado.auditoria(requisicao_id,acao)
  where acao in ('auth.operador.tentativa','auth.operador.resultado');

create function public.painel_iniciar_cadastro_operador(p_gestor uuid,p_empresa uuid,p_email text,p_perfil text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_req uuid := gen_random_uuid();
begin
  perform 1 from public.membros where empresa_id=p_empresa and usuario_id=p_gestor and papel='gestor' for share;
  if not found or p_perfil is null or p_perfil not in ('vendas','cozinha') then raise insufficient_privilege; end if;
  if p_email is null or length(btrim(p_email)) not between 3 and 254 then raise sqlstate '22023'; end if;
  if exists(select 1 from auth.users where id=p_gestor and lower(email)=lower(btrim(p_email))) then
    raise insufficient_privilege;
  end if;
  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,depois,requisicao_id)
  values (p_gestor,'usuario','loja',p_empresa,'auth.operador.tentativa','auth_operador',
    jsonb_build_object('email',lower(btrim(p_email)),'perfil',p_perfil),v_req);
  return v_req;
end;
$$;

create function public.painel_concluir_cadastro_operador(p_requisicao uuid,p_operador uuid,p_caixa text,p_resultado text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_tentativa painel_privado.auditoria;
  v_existente text;
begin
  if p_requisicao is null or p_resultado is null or p_resultado not in
    ('vinculado','auth_recusado','auth_revertido','indeterminado') then raise sqlstate '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_requisicao::text,53));
  select a.* into v_tentativa from painel_privado.auditoria a
    where a.requisicao_id=p_requisicao and a.acao='auth.operador.tentativa';
  if not found then raise insufficient_privilege; end if;
  select a.depois->>'resultado' into v_existente from painel_privado.auditoria a
    where a.requisicao_id=p_requisicao and a.acao='auth.operador.resultado';
  if found then return v_existente; end if;

  if p_resultado='vinculado' then
    if p_operador is null or not exists(select 1 from auth.users u
        where u.id=p_operador and lower(u.email)=v_tentativa.depois->>'email')
      or exists(select 1 from public.membros m where m.usuario_id=p_operador and m.papel='gestor') then
      raise insufficient_privilege;
    end if;
    perform set_config('painel.equipe_autor',v_tentativa.autor_id::text,true);
    perform set_config('painel.equipe_requisicao',p_requisicao::text,true);
    if v_tentativa.depois->>'perfil'='cozinha' then
      perform public.vincular_novo_usuario_kds(v_tentativa.autor_id,v_tentativa.empresa_id,p_operador);
    else
      perform public.vincular_novo_operador_pdv(v_tentativa.autor_id,v_tentativa.empresa_id,p_operador,p_caixa);
    end if;
  end if;
  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
  values (v_tentativa.autor_id,'usuario','loja',v_tentativa.empresa_id,'auth.operador.resultado',
    'auth_operador',p_operador::text,v_tentativa.depois||jsonb_build_object('resultado',p_resultado),p_requisicao);
  return p_resultado;
end;
$$;

revoke all on function public.painel_iniciar_cadastro_operador(uuid,uuid,text,text),
  public.painel_concluir_cadastro_operador(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.painel_iniciar_cadastro_operador(uuid,uuid,text,text),
  public.painel_concluir_cadastro_operador(uuid,uuid,text,text) to service_role;

commit;
