begin;

alter table public.empresas add column nome_pdv text check (length(btrim(nome_pdv)) between 1 and 100);

create table public.terminais_pdv (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null check (length(btrim(nome)) between 1 and 60),
  operador_id uuid not null references auth.users(id),
  unique (empresa_id, id)
);
create unique index terminais_pdv_nome on public.terminais_pdv (empresa_id, lower(nome));
alter table public.terminais_pdv enable row level security;
revoke all on public.terminais_pdv from public, anon, authenticated;
grant select on public.terminais_pdv to authenticated;
create policy consultar_terminal on public.terminais_pdv for select to authenticated using (
  exists (select 1 from public.membros m where m.empresa_id = terminais_pdv.empresa_id
    and m.usuario_id = auth.uid() and (m.papel = 'gestor' or terminais_pdv.operador_id = m.usuario_id))
);

alter table public.caixas add column terminal_id uuid;
alter table public.caixas add foreign key (empresa_id, terminal_id) references public.terminais_pdv(empresa_id, id);

-- Preserva os turnos existentes e dá aos membros atuais um caixa inicial identificado.
insert into public.terminais_pdv (empresa_id, nome, operador_id)
select empresa_id, 'Caixa ' || lpad(numero::text, greatest(2, length(numero::text)), '0'), usuario_id
from (select m.*, row_number() over (partition by empresa_id order by papel, usuario_id) numero
  from public.membros m) membros;
update public.caixas c set terminal_id = t.id
from public.terminais_pdv t where t.empresa_id = c.empresa_id and t.operador_id = c.operador_id;

create unique index terminal_pdv_turno_aberto on public.caixas(terminal_id) where fechado_em is null;

create function public.abrir_caixa(p_empresa uuid, p_abertura bigint, p_terminal uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_caixa uuid;
begin
  perform 1 from public.terminais_pdv t
    where t.id = p_terminal and t.empresa_id = p_empresa and t.operador_id = auth.uid()
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
    for share;
  if not found then raise exception 'Caixa indisponível para este operador.' using errcode = '42501'; end if;
  insert into public.caixas(empresa_id, operador_id, abertura_centavos, terminal_id)
    values (p_empresa, auth.uid(), p_abertura, p_terminal) returning id into v_caixa;
  return v_caixa;
end;
$$;

create function public.configurar_nome_pdv(p_empresa uuid, p_nome text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.empresas set nome_pdv = btrim(p_nome) where id = p_empresa and exists (
    select 1 from public.membros where empresa_id = p_empresa and usuario_id = auth.uid() and papel = 'gestor'
  );
  if not found then raise exception 'Somente o gestor pode configurar o PDV.' using errcode = '42501'; end if;
end;
$$;

create function public.configurar_terminal_pdv(p_empresa uuid, p_terminal uuid, p_nome text, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_operador uuid; v_terminal uuid;
begin
  if not exists (select 1 from public.membros where empresa_id = p_empresa and usuario_id = auth.uid() and papel = 'gestor')
  then raise exception 'Somente o gestor pode configurar caixas.' using errcode = '42501'; end if;
  select m.usuario_id into v_operador from public.membros m join auth.users u on u.id = m.usuario_id
    where m.empresa_id = p_empresa and lower(u.email) = lower(btrim(p_email));
  if not found then raise exception 'O operador precisa ter uma conta vinculada à loja.'; end if;
  if p_terminal is null then
    insert into public.terminais_pdv(empresa_id,nome,operador_id)
      values (p_empresa,btrim(p_nome),v_operador) returning id into v_terminal;
  else
    perform 1 from public.terminais_pdv where id = p_terminal and empresa_id = p_empresa for update;
    if not found then raise exception 'Caixa indisponível.'; end if;
    if exists (select 1 from public.caixas where terminal_id = p_terminal and fechado_em is null)
      then raise exception 'Feche o turno antes de alterar o caixa.'; end if;
    update public.terminais_pdv set nome = btrim(p_nome), operador_id = v_operador
      where id = p_terminal returning id into v_terminal;
  end if;
  return v_terminal;
end;
$$;

revoke execute on function public.abrir_caixa(uuid,bigint) from public, anon, authenticated;
revoke execute on function public.abrir_caixa(uuid,bigint,uuid), public.configurar_nome_pdv(uuid,text),
  public.configurar_terminal_pdv(uuid,uuid,text,text) from public, anon;
grant execute on function public.abrir_caixa(uuid,bigint,uuid), public.configurar_nome_pdv(uuid,text),
  public.configurar_terminal_pdv(uuid,uuid,text,text) to authenticated;

commit;
