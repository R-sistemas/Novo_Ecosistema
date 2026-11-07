begin;

create function public.remover_operador_loja(p_empresa uuid,p_email text)
returns void language plpgsql security definer set search_path='' as $$
declare operador uuid; removidos integer;
begin
  if not public.eh_gestor_kds(p_empresa) then
    raise exception 'Somente o gestor pode remover operadores.' using errcode='42501';
  end if;
  select id into operador from auth.users where lower(email)=lower(btrim(p_email));
  if operador is null then raise exception 'Operador indisponível nesta loja.'; end if;

  -- Serialize removal with the start of a shift for this operator.
  perform 1 from public.membros where empresa_id=p_empresa and usuario_id=operador and papel='operador' for update;
  if found and exists (select 1 from public.caixas where empresa_id=p_empresa and operador_id=operador and fechado_em is null) then
    raise exception 'Feche o turno do operador antes de remover seu acesso.';
  end if;

  with vendas as (
    delete from public.membros where empresa_id=p_empresa and usuario_id=operador and papel='operador' returning 1
  ), cozinha as (
    delete from public.equipe_kds where empresa_id=p_empresa and usuario_id=operador returning 1
  )
  select count(*) into removidos from (select * from vendas union all select * from cozinha) vinculos;
  if removidos=0 then raise exception 'Operador indisponível nesta loja.'; end if;
end;
$$;

create or replace function public.abrir_caixa(p_empresa uuid,p_abertura bigint,p_terminal uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caixa uuid;
begin
  perform 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid() for share;
  if not found then raise exception 'Caixa indisponível para este operador.' using errcode='42501'; end if;
  perform 1 from public.terminais_pdv where id=p_terminal and empresa_id=p_empresa and operador_id=auth.uid() for share;
  if not found then raise exception 'Caixa indisponível para este operador.' using errcode='42501'; end if;
  insert into public.caixas(empresa_id,operador_id,abertura_centavos,terminal_id)
    values(p_empresa,auth.uid(),p_abertura,p_terminal) returning id into caixa;
  return caixa;
end;
$$;

create or replace function public.listar_terminais_gestor(p_empresa uuid)
returns table(id uuid,nome text,email text)
language sql stable security definer set search_path='' as $$
  select t.id,t.nome,u.email::text
  from public.terminais_pdv t
  left join public.membros m on m.empresa_id=t.empresa_id and m.usuario_id=t.operador_id
  left join auth.users u on u.id=m.usuario_id
  where t.empresa_id=p_empresa and public.eh_gestor_kds(p_empresa)
  order by t.nome;
$$;

revoke execute on function public.remover_operador_loja(uuid,text) from public,anon;
grant execute on function public.remover_operador_loja(uuid,text) to authenticated;

commit;
