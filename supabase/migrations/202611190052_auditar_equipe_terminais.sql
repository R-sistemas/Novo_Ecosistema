begin;

create function painel_privado.snapshot_equipe(p_tabela text, p_linha jsonb)
returns jsonb language sql stable set search_path = ''
as $$
  select case when p_linha is not null then jsonb_strip_nulls(jsonb_build_object(
    'empresa_id', coalesce(p_linha->'empresa_id', p_linha->'id'),
    'usuario_id', coalesce(p_linha->'usuario_id', p_linha->'operador_id'),
    'email', (select u.email from auth.users u
      where u.id=(coalesce(p_linha->>'usuario_id',p_linha->>'operador_id'))::uuid),
    'papel', p_linha->'papel', 'edita_comanda', p_linha->'edita_comanda',
    'nome', case when p_tabela='terminais_pdv' then p_linha->'nome' end,
    'nome_pdv', p_linha->'nome_pdv'
  )) end;
$$;

create function painel_privado.registrar_equipe(p_tabela text,p_acao text,p_antes jsonb,p_depois jsonb,p_requisicao uuid)
returns void language plpgsql set search_path = ''
as $$
declare
  v_linha jsonb := coalesce(p_depois,p_antes);
  v_servico boolean := coalesce(auth.role()='service_role' or current_setting('role',true)='service_role',false);
  v_autor uuid := auth.uid();
begin
  if v_autor is null and v_servico then
    v_autor := nullif(current_setting('painel.equipe_autor',true),'')::uuid;
    p_requisicao := coalesce(nullif(current_setting('painel.equipe_requisicao',true),'')::uuid,p_requisicao);
  end if;
  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,antes,depois,requisicao_id)
  values (coalesce(v_autor,'00000000-0000-0000-0000-000000000000'),
    case when v_autor is not null then 'usuario' when v_servico then 'servico' else 'sistema' end,
    'loja',(coalesce(v_linha->>'empresa_id',v_linha->>'id'))::uuid,
    p_tabela||'.'||p_acao,p_tabela,coalesce(v_linha->>'id',v_linha->>'usuario_id'),
    painel_privado.snapshot_equipe(p_tabela,p_antes),painel_privado.snapshot_equipe(p_tabela,p_depois),p_requisicao);
end;
$$;

create function painel_privado.auditar_equipe()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_linha jsonb; v_req uuid := gen_random_uuid();
begin
  if tg_op='TRUNCATE' then
    for v_linha in execute format('select to_jsonb(t) from public.%I t',tg_table_name) loop
      perform painel_privado.registrar_equipe(tg_table_name,'excluir',v_linha,null,v_req);
    end loop;
  else
    perform painel_privado.registrar_equipe(tg_table_name,
      case tg_op when 'INSERT' then 'criar' when 'UPDATE' then 'editar' else 'excluir' end,
      case when tg_op<>'INSERT' then to_jsonb(old) end,
      case when tg_op<>'DELETE' then to_jsonb(new) end,v_req);
  end if;
  return null;
end;
$$;

revoke all on function painel_privado.snapshot_equipe(text,jsonb),
  painel_privado.registrar_equipe(text,text,jsonb,jsonb,uuid),painel_privado.auditar_equipe()
  from public,anon,authenticated,service_role;

create trigger auditar_membros after insert or update or delete on public.membros
  for each row execute function painel_privado.auditar_equipe();
create trigger auditar_terminais after insert or update or delete on public.terminais_pdv
  for each row execute function painel_privado.auditar_equipe();
create trigger auditar_equipe_kds after insert or update or delete on public.equipe_kds
  for each row execute function painel_privado.auditar_equipe();
create trigger auditar_membros_truncate before truncate on public.membros
  for each statement execute function painel_privado.auditar_equipe();
create trigger auditar_terminais_truncate before truncate on public.terminais_pdv
  for each statement execute function painel_privado.auditar_equipe();
create trigger auditar_equipe_kds_truncate before truncate on public.equipe_kds
  for each statement execute function painel_privado.auditar_equipe();
create trigger auditar_nome_pdv after update of nome_pdv on public.empresas
  for each row when (old.nome_pdv is distinct from new.nome_pdv) execute function painel_privado.auditar_equipe();

commit;
