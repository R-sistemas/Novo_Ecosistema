begin;

create table painel_privado.auditoria (
  id uuid primary key default gen_random_uuid(),
  ocorrido_em timestamptz not null default clock_timestamp(),
  autor_id uuid not null,
  escopo text not null,
  empresa_id uuid,
  acao text not null check (btrim(acao) <> ''),
  entidade text not null check (btrim(entidade) <> ''),
  entidade_id text,
  antes jsonb,
  depois jsonb,
  motivo text,
  requisicao_id uuid not null,
  check (
    (escopo = 'loja' and empresa_id is not null)
    or (escopo = 'plataforma' and empresa_id is null)
  )
);

alter table painel_privado.auditoria enable row level security;
revoke all on painel_privado.auditoria from public, anon, authenticated, service_role;

create function painel_privado.proteger_auditoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Auditoria aceita somente inserções';
end;
$$;
revoke all on function painel_privado.proteger_auditoria() from public, anon, authenticated, service_role;

create trigger auditoria_append_only
before update or delete or truncate on painel_privado.auditoria
for each statement execute function painel_privado.proteger_auditoria();

commit;
