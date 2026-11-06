begin;

alter table public.empresas add column pagamento_na_entrega boolean not null default false;

create function public.configurar_pagamento_na_entrega(p_empresa uuid, p_habilitado boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.empresas e set pagamento_na_entrega = p_habilitado
    where e.id = p_empresa and exists (
      select 1 from public.membros m
      where m.empresa_id = e.id and m.usuario_id = auth.uid() and m.papel = 'gestor'
    );
  if not found then raise exception 'Somente o gestor pode alterar esta configuração.'; end if;
end;
$$;

revoke execute on function public.configurar_pagamento_na_entrega(uuid,boolean) from public, anon;
grant execute on function public.configurar_pagamento_na_entrega(uuid,boolean) to authenticated;

commit;
