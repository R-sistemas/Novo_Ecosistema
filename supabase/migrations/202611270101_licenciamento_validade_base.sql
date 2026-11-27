begin;

create schema licenciamento_privado;
revoke all on schema licenciamento_privado from public, anon, authenticated, service_role;

create table licenciamento_privado.configuracao (
  unica boolean primary key default true check (unica),
  admissao_ativa boolean not null default false,
  cobranca_ativa boolean not null default false,
  avisos_ativos boolean not null default false,
  exclusao_ativa boolean not null default false
);
insert into licenciamento_privado.configuracao default values;

create table licenciamento_privado.empresas_fiscais (
  empresa_id uuid primary key references public.empresas(id),
  cnpj text not null unique check (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  registrado_em timestamptz not null default statement_timestamp()
);

-- O consumo do trial sobrevive ao encerramento dos dados operacionais.
create table licenciamento_privado.trials_usados (
  cnpj text primary key references licenciamento_privado.empresas_fiscais(cnpj),
  inicio timestamptz not null
);

create table licenciamento_privado.ofertas (
  id uuid primary key default gen_random_uuid(),
  plano text not null check (length(btrim(plano)) between 1 and 80),
  versao integer not null check (versao > 0),
  meses smallint not null check (meses in (1, 6)),
  preco_centavos integer not null check (preco_centavos > 0),
  desconto_pix_basis_points integer check (desconto_pix_basis_points between 0 and 9999),
  termos_versao text not null check (length(btrim(termos_versao)) between 1 and 80),
  comercializavel boolean not null default false,
  unique (plano, versao, meses),
  check (meses <> 1 or desconto_pix_basis_points is null)
);

create table licenciamento_privado.contratos (
  empresa_id uuid primary key references public.empresas(id),
  politica text not null check (politica in ('legado_dia5', 'aniversario')),
  fase text not null check (fase in ('preparacao','trial','ativa','encerrada')),
  ancora_dia smallint check (ancora_dia between 1 and 31),
  oferta_id uuid references licenciamento_privado.ofertas(id),
  trial_inicio timestamptz,
  trial_fim timestamptz,
  valido_ate date,
  nao_renovar boolean not null default false,
  invalido_em timestamptz,
  acesso_encerrado_em timestamptz,
  retencao_ate timestamptz,
  revisao integer not null default 1 check (revisao > 0),
  criado_em timestamptz not null default statement_timestamp(),
  check ((trial_inicio is null and trial_fim is null)
    or (trial_inicio is not null and trial_fim is not null and trial_fim = trial_inicio + interval '168 hours')),
  check (fase <> 'trial' or trial_fim is not null),
  check (politica <> 'legado_dia5' or ancora_dia is not distinct from 5),
  check (politica <> 'aniversario' or fase <> 'ativa'
    or (ancora_dia is not null and valido_ate is not null and oferta_id is not null)),
  check (retencao_ate is null or (acesso_encerrado_em is not null and retencao_ate >= acesso_encerrado_em))
);

-- A licença legada original continua canônica para essas empresas. A expansão não reclassifica pagamentos.
insert into licenciamento_privado.contratos(empresa_id, politica, fase, ancora_dia, valido_ate)
  select empresa_id, 'legado_dia5',
    case when estado = 'ativa' then 'ativa' else 'preparacao' end, 5, vencimento
  from painel_privado.central_licencas
  on conflict (empresa_id) do nothing;

alter table licenciamento_privado.configuracao enable row level security;
alter table licenciamento_privado.empresas_fiscais enable row level security;
alter table licenciamento_privado.trials_usados enable row level security;
alter table licenciamento_privado.ofertas enable row level security;
alter table licenciamento_privado.contratos enable row level security;
revoke all on all tables in schema licenciamento_privado from public, anon, authenticated, service_role;

commit;
