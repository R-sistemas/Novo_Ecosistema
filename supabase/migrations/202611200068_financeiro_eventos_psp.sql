begin;

-- Contrato para observações autenticadas e normalizadas, sem payload nem credenciais.
create table painel_privado.financeiro_eventos_psp (
  empresa_id uuid not null,
  provedor text not null,
  ambiente text not null check (ambiente in ('producao','sandbox')),
  cobranca_id text not null,
  evento_id text not null,
  ocorrido_em timestamptz not null,
  estado text not null check (estado in (
    'confirmado','pendente','recusado','cancelado','estornado','estorno_parcial','contestacao','desconhecido'
  )),
  valor_centavos bigint check (valor_centavos >= 0),
  primary key (empresa_id, provedor, ambiente, evento_id),
  foreign key (empresa_id, provedor, cobranca_id)
    references public.pagamentos_online (empresa_id, provedor, cobranca_id)
);

create index financeiro_eventos_psp_periodo on painel_privado.financeiro_eventos_psp
  (empresa_id, ambiente, ocorrido_em);

alter table painel_privado.financeiro_eventos_psp enable row level security;
revoke all on painel_privado.financeiro_eventos_psp from public, anon, authenticated, service_role;

commit;
