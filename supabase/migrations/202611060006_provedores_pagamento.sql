begin;

create table public.provedores_pagamento (
  empresa_id uuid not null references public.empresas(id),
  provedor text not null check (provedor ~ '^[a-z][a-z0-9_]*$'),
  ambiente text not null check (ambiente in ('sandbox', 'producao')),
  pix_habilitado boolean not null default false,
  credito_habilitado boolean not null default false,
  debito_habilitado boolean not null default false,
  primary key (empresa_id, provedor, ambiente)
);

alter table public.provedores_pagamento enable row level security;
revoke all on public.provedores_pagamento from public, anon, authenticated;
grant select on public.provedores_pagamento to service_role;

insert into public.provedores_pagamento(empresa_id, provedor, ambiente)
select id, 'asaas', 'producao'
from public.empresas where cardapio_slug = 'quiosque-dorafa';

commit;
