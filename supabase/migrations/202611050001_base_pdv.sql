begin;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) > 0)
);

create table public.membros (
  empresa_id uuid not null references public.empresas(id),
  usuario_id uuid not null references auth.users(id),
  papel text not null check (papel in ('gestor', 'operador')),
  primary key (empresa_id, usuario_id)
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null check (length(btrim(codigo)) > 0),
  nome text not null check (length(btrim(nome)) > 0),
  preco_centavos bigint not null check (preco_centavos > 0),
  ativo boolean not null default true,
  unique (empresa_id, codigo),
  unique (empresa_id, id)
);

create table public.caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  operador_id uuid not null references auth.users(id),
  abertura_centavos bigint not null check (abertura_centavos >= 0),
  aberto_em timestamptz not null default now(),
  fechado_em timestamptz,
  contado_centavos bigint check (contado_centavos >= 0),
  unique (empresa_id, id),
  check ((fechado_em is null) = (contado_centavos is null))
);

create unique index caixa_aberto_por_operador
  on public.caixas (empresa_id, operador_id) where fechado_em is null;

create table public.movimentos_caixa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  caixa_id uuid not null,
  tipo text not null check (tipo in ('suprimento', 'sangria', 'venda')),
  valor_centavos bigint not null check (valor_centavos > 0),
  meio text not null check (meio in ('dinheiro', 'pix', 'cartao')),
  criado_em timestamptz not null default now(),
  foreign key (empresa_id, caixa_id) references public.caixas(empresa_id, id),
  check (tipo = 'venda' or meio = 'dinheiro')
);

alter table public.empresas enable row level security;
alter table public.membros enable row level security;
alter table public.produtos enable row level security;
alter table public.caixas enable row level security;
alter table public.movimentos_caixa enable row level security;

revoke all on public.empresas, public.membros, public.produtos, public.caixas,
  public.movimentos_caixa from anon, authenticated;
grant select on public.empresas, public.membros, public.produtos, public.caixas,
  public.movimentos_caixa to authenticated;
grant insert, update on public.produtos to authenticated;

create policy membros_proprios on public.membros for select to authenticated
  using (usuario_id = (select auth.uid()));

create policy empresas_do_usuario on public.empresas for select to authenticated
  using (id in (select empresa_id from public.membros));

create policy produtos_da_empresa on public.produtos for select to authenticated
  using (empresa_id in (select empresa_id from public.membros));

create policy gestor_cadastra_produto on public.produtos for insert to authenticated
  with check (empresa_id in (select empresa_id from public.membros where papel = 'gestor'));

create policy gestor_atualiza_produto on public.produtos for update to authenticated
  using (empresa_id in (select empresa_id from public.membros where papel = 'gestor'))
  with check (empresa_id in (select empresa_id from public.membros where papel = 'gestor'));

create policy caixas_visiveis on public.caixas for select to authenticated
  using (
    empresa_id in (select empresa_id from public.membros)
    and (operador_id = (select auth.uid())
      or empresa_id in (select empresa_id from public.membros where papel = 'gestor'))
  );

create policy movimentos_visiveis on public.movimentos_caixa for select to authenticated
  using (exists (select 1 from public.caixas c where c.id = caixa_id));

commit;
