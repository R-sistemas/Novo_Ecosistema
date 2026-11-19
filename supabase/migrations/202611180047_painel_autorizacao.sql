begin;

create schema painel_privado;
revoke all on schema painel_privado from public, anon, authenticated, service_role;

create table painel_privado.papeis_centrais (
  codigo text primary key
);
create table painel_privado.capacidades_centrais (
  codigo text primary key
);
create table painel_privado.capacidades_por_papel (
  papel text not null references painel_privado.papeis_centrais(codigo),
  capacidade text not null references painel_privado.capacidades_centrais(codigo),
  primary key (papel, capacidade)
);
create table painel_privado.vinculos_centrais (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  papel text not null references painel_privado.papeis_centrais(codigo),
  primary key (usuario_id, papel)
);

alter table painel_privado.papeis_centrais enable row level security;
alter table painel_privado.capacidades_centrais enable row level security;
alter table painel_privado.capacidades_por_papel enable row level security;
alter table painel_privado.vinculos_centrais enable row level security;
revoke all on all tables in schema painel_privado from public, anon, authenticated, service_role;

insert into painel_privado.papeis_centrais values ('central');
insert into painel_privado.capacidades_centrais values ('central.sessao');
insert into painel_privado.capacidades_por_papel values ('central', 'central.sessao');

-- O vínculo vigente do gestor já provisiona as lojas existentes e futuras.
-- A remoção desse vínculo vale na requisição seguinte, sem cópia nem backfill de usuários.
create function public.painel_contexto_sessao(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_perfis text[];
  v_capacidades text[];
begin
  if v_usuario is null then
    raise exception using errcode = '42501', message = 'Acesso negado';
  end if;

  if p_empresa_id is not null then
    if not exists (
      select 1 from public.membros
      where usuario_id = v_usuario and empresa_id = p_empresa_id and papel = 'gestor'
    ) then
      raise exception using errcode = '42501', message = 'Acesso negado';
    end if;
    return jsonb_build_object(
      'escopo', 'loja', 'usuario_id', v_usuario, 'empresa_id', p_empresa_id,
      'perfis', array['gestor'], 'capacidades', array['loja.sessao']
    );
  end if;

  select array_agg(distinct v.papel order by v.papel),
         array_agg(distinct c.capacidade order by c.capacidade)
    into v_perfis, v_capacidades
  from painel_privado.vinculos_centrais v
  join painel_privado.capacidades_por_papel c on c.papel = v.papel
  where v.usuario_id = v_usuario;

  if not coalesce('central.sessao' = any(v_capacidades), false) then
    raise exception using errcode = '42501', message = 'Acesso negado';
  end if;
  return jsonb_build_object(
    'escopo', 'central', 'usuario_id', v_usuario, 'empresa_id', null,
    'perfis', v_perfis, 'capacidades', v_capacidades
  );
end;
$$;

revoke all on function public.painel_contexto_sessao(uuid) from public, anon, authenticated, service_role;
grant execute on function public.painel_contexto_sessao(uuid) to authenticated;

commit;
