begin;

alter table public.empresas add column cardapio_slug text unique
  check (cardapio_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create table public.mesas_cardapio (
  token uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  numero integer not null check (numero > 0),
  unique (empresa_id, numero)
);

create table public.pedidos_online (
  id uuid primary key,
  empresa_id uuid not null references public.empresas(id),
  cliente text not null check (length(btrim(cliente)) between 1 and 100),
  mesa integer,
  itens jsonb not null,
  total_centavos bigint not null check (total_centavos > 0),
  estado text not null default 'novo' check (estado in ('novo','preparo','pronto','entregue','recusado')),
  criado_em timestamptz not null default now()
);

create index pedidos_online_empresa on public.pedidos_online (empresa_id, criado_em);
alter table public.mesas_cardapio enable row level security;
alter table public.pedidos_online enable row level security;
revoke all on public.mesas_cardapio, public.pedidos_online from public, anon, authenticated;
grant select on public.pedidos_online to authenticated;
create policy pedidos_da_empresa on public.pedidos_online for select to authenticated
  using (empresa_id in (select empresa_id from public.membros));

create function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', e.nome, 'produtos', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome,
      'preco_centavos', p.preco_centavos) order by p.nome)
    from public.produtos p where p.empresa_id = e.id and p.ativo
  ), '[]'::jsonb))
  from public.empresas e where e.cardapio_slug = p_slug;
$$;

create function public.enviar_pedido(p_slug text, p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_mesa integer;
  v_itens jsonb;
  v_total bigint;
begin
  select id into v_empresa from public.empresas where cardapio_slug = p_slug;
  if v_empresa is null then raise exception 'Cardápio indisponível.'; end if;
  if p_mesa is not null then
    select numero into v_mesa from public.mesas_cardapio where token = p_mesa and empresa_id = v_empresa;
    if not found then raise exception 'Mesa inválida.'; end if;
  end if;
  if p_id is null or p_cliente is null or length(btrim(p_cliente)) not between 1 and 100
    or jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'Dados do pedido inválidos.';
  end if;
  if jsonb_array_length(p_itens) not between 1 and 30 then raise exception 'Carrinho inválido.'; end if;

  with itens as (
    select i.produto_id, i.quantidade
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade integer)
  )
  select jsonb_agg(jsonb_build_object('produto_id', p.id, 'nome', p.nome,
    'quantidade', i.quantidade, 'preco_centavos', p.preco_centavos) order by p.id),
    sum(p.preco_centavos * i.quantidade)
  into v_itens, v_total
  from itens i join public.produtos p on p.id = i.produto_id and p.empresa_id = v_empresa and p.ativo
  where i.quantidade between 1 and 100;

  if v_itens is null or jsonb_array_length(v_itens) <> jsonb_array_length(p_itens) then
    raise exception 'Item indisponível ou quantidade inválida.';
  end if;
  insert into public.pedidos_online(id, empresa_id, cliente, mesa, itens, total_centavos)
    values (p_id, v_empresa, btrim(p_cliente), v_mesa, v_itens, v_total)
    on conflict (id) do nothing;
  if not found and not exists (select 1 from public.pedidos_online p where p.id = p_id
    and p.empresa_id = v_empresa and p.cliente = btrim(p_cliente)
    and p.mesa is not distinct from v_mesa and p.itens = v_itens) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  return p_id;
end;
$$;

create function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'total_centavos', p.total_centavos)
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  where e.cardapio_slug = p_slug and p.id = p_id;
$$;

create function public.avancar_pedido(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos_online p set estado = p_estado
  where p.id = p_id
    and exists (select 1 from public.membros m where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid())
    and ((p.estado = 'novo' and p_estado in ('preparo', 'recusado'))
      or (p.estado = 'preparo' and p_estado = 'pronto')
      or (p.estado = 'pronto' and p_estado = 'entregue'));
  if not found then raise exception 'Pedido indisponível ou transição inválida.'; end if;
end;
$$;

revoke execute on function public.ver_cardapio(text), public.enviar_pedido(text,uuid,text,uuid,jsonb),
  public.acompanhar_pedido(text,uuid), public.avancar_pedido(uuid,text) from public, anon, authenticated;
grant execute on function public.ver_cardapio(text), public.enviar_pedido(text,uuid,text,uuid,jsonb),
  public.acompanhar_pedido(text,uuid) to anon, authenticated;
grant execute on function public.avancar_pedido(uuid,text) to authenticated;

commit;
