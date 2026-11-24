begin;

create table painel_privado.mp_webhook_pre_aprovacao (
  integracao_id uuid not null references painel_privado.credenciais_mp(id),
  tipo text not null check (tipo in ('ordem','pagamento')),
  recurso_id text not null check (recurso_id ~ '^[A-Za-z0-9]{1,80}$'),
  verificado_em timestamptz not null default clock_timestamp(),
  primary key (integracao_id,tipo,recurso_id)
);
alter table painel_privado.mp_webhook_pre_aprovacao enable row level security;
revoke all on painel_privado.mp_webhook_pre_aprovacao from public,anon,authenticated,service_role;

create function public.servico_mp_registrar_webhook_pendente(p_integracao uuid,p_tipo text,p_recurso text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into painel_privado.mp_webhook_pre_aprovacao(integracao_id,tipo,recurso_id)
    select id,p_tipo,p_recurso from painel_privado.credenciais_mp where id=p_integracao
    on conflict (integracao_id,tipo,recurso_id) do nothing;
  return found;
end;
$$;
revoke all on function public.servico_mp_registrar_webhook_pendente(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.servico_mp_registrar_webhook_pendente(uuid,text,text) to service_role;

commit;
