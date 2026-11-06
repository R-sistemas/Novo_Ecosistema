create table public.asaas_sandbox_eventos (
  evento_id text primary key,
  cobranca_id text not null,
  tipo text not null check (tipo = 'PAYMENT_RECEIVED'),
  recebido_em timestamptz not null default now()
);

alter table public.asaas_sandbox_eventos enable row level security;
revoke all on public.asaas_sandbox_eventos from public, anon, authenticated;
grant insert, select on public.asaas_sandbox_eventos to service_role;
