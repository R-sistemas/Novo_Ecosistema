begin;

-- The service invokes these narrow, manager-checked operations without direct table grants.
alter function public.vincular_novo_usuario_kds(uuid,uuid,uuid) security definer;
alter function public.vincular_novo_operador_pdv(uuid,uuid,uuid,text) security definer;

create function public.listar_operadores_gestor(p_empresa uuid)
returns table(email text, vendas boolean, cozinha boolean, edita_comanda boolean, caixas text[])
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.eh_gestor_kds(p_empresa) then
    raise exception 'Somente o gestor pode consultar a equipe da loja.' using errcode='42501';
  end if;
  return query
    select u.email::text, m.usuario_id is not null, k.usuario_id is not null,
      coalesce(k.edita_comanda,false),
      array(select t.nome from public.terminais_pdv t
        where t.empresa_id=p_empresa and t.operador_id=u.id order by t.nome)
    from auth.users u
    left join public.membros m on m.usuario_id=u.id and m.empresa_id=p_empresa and m.papel='operador'
    left join public.equipe_kds k on k.usuario_id=u.id and k.empresa_id=p_empresa
    where (m.usuario_id is not null or k.usuario_id is not null) and u.email is not null
    order by u.email;
end;
$$;
revoke execute on function public.listar_operadores_gestor(uuid) from public,anon;
grant execute on function public.listar_operadores_gestor(uuid) to authenticated;

commit;
