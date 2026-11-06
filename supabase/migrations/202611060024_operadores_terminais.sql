begin;

create function public.listar_terminais_gestor(p_empresa uuid)
returns table(id uuid, nome text, email text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.nome, u.email::text
  from public.terminais_pdv t join auth.users u on u.id = t.operador_id
  where t.empresa_id = p_empresa and exists (
    select 1 from public.membros m where m.empresa_id = p_empresa
      and m.usuario_id = auth.uid() and m.papel = 'gestor'
  )
  order by t.nome;
$$;

revoke execute on function public.listar_terminais_gestor(uuid) from public, anon;
grant execute on function public.listar_terminais_gestor(uuid) to authenticated;

commit;
