begin;

lock table public.pedidos_online in access exclusive mode;

create table painel_privado.contadores_comanda (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ultimo bigint not null check (ultimo > 0)
);
revoke all on painel_privado.contadores_comanda from public, anon, authenticated, service_role;

insert into painel_privado.contadores_comanda (empresa_id, ultimo)
select empresa_id, max(comanda)
from public.pedidos_online
group by empresa_id;

alter table public.pedidos_online
  alter column comanda drop identity,
  drop constraint pedidos_online_comanda_key,
  add constraint pedidos_online_empresa_comanda_key unique (empresa_id, comanda);

create function painel_privado.numerar_comanda()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into painel_privado.contadores_comanda as contador (empresa_id, ultimo)
    values (new.empresa_id, 1)
    on conflict (empresa_id) do update set ultimo = contador.ultimo + 1
    returning ultimo into new.comanda;
  return new;
end;
$$;

revoke all on function painel_privado.numerar_comanda() from public, anon, authenticated, service_role;
create trigger numerar_comanda before insert on public.pedidos_online
  for each row execute function painel_privado.numerar_comanda();

commit;
