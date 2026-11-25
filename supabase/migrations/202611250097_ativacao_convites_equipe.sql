begin;

create function painel_privado.configurar_convites_equipe(p_empresas uuid[],p_habilitado boolean)
returns void language plpgsql set search_path = '' as $$
declare empresa uuid;
begin
  if p_habilitado is null or coalesce(cardinality(p_empresas),0)=0 or array_position(p_empresas,null) is not null
    then raise sqlstate '22023'; end if;
  for empresa in select distinct id from unnest(p_empresas) as lojas(id) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(empresa::text,98));
    if p_habilitado then
      insert into painel_privado.convites_equipe_ativacao(empresa_id,habilitado) values (empresa,true)
        on conflict (empresa_id) do update set habilitado=excluded.habilitado;
    else
      update painel_privado.convites_equipe_ativacao a set habilitado=false where a.empresa_id=empresa;
    end if;
  end loop;
end;
$$;

alter function public.painel_iniciar_cadastro_operador(uuid,uuid,text,text)
  rename to painel_iniciar_cadastro_operador_legado;
alter function public.painel_concluir_cadastro_operador(uuid,uuid,text,text)
  rename to painel_concluir_cadastro_operador_legado;

create function public.painel_iniciar_cadastro_operador(p_gestor uuid,p_empresa uuid,p_email text,p_perfil text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended(p_empresa::text,98));
  if exists(select 1 from painel_privado.convites_equipe_ativacao a where a.empresa_id=p_empresa)
    then raise insufficient_privilege; end if;
  return public.painel_iniciar_cadastro_operador_legado(p_gestor,p_empresa,p_email,p_perfil);
end;
$$;

create function public.painel_concluir_cadastro_operador(p_requisicao uuid,p_operador uuid,p_caixa text,p_resultado text)
returns text language plpgsql security definer set search_path = '' as $$
declare empresa uuid;
begin
  if p_resultado='vinculado' then
    select a.empresa_id into empresa from painel_privado.auditoria a
      where a.requisicao_id=p_requisicao and a.acao='auth.operador.tentativa';
    perform pg_advisory_xact_lock_shared(hashtextextended(empresa::text,98));
    if exists(select 1 from painel_privado.convites_equipe_ativacao a where a.empresa_id=empresa)
      and not exists(select 1 from painel_privado.auditoria a
        where a.requisicao_id=p_requisicao and a.acao='auth.operador.resultado') then
      raise insufficient_privilege;
    end if;
  end if;
  return public.painel_concluir_cadastro_operador_legado(p_requisicao,p_operador,p_caixa,p_resultado);
end;
$$;

revoke all on function painel_privado.configurar_convites_equipe(uuid[],boolean),
  public.painel_iniciar_cadastro_operador_legado(uuid,uuid,text,text),
  public.painel_concluir_cadastro_operador_legado(uuid,uuid,text,text),
  public.painel_iniciar_cadastro_operador(uuid,uuid,text,text),
  public.painel_concluir_cadastro_operador(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.painel_iniciar_cadastro_operador(uuid,uuid,text,text),
  public.painel_concluir_cadastro_operador(uuid,uuid,text,text) to service_role;

commit;
