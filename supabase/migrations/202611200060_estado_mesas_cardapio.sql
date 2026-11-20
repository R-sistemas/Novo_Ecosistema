begin;

alter table public.mesas_cardapio
  add column ativo boolean not null default true,
  add column criado_em timestamptz;
alter table public.mesas_cardapio alter column criado_em set default clock_timestamp();

create or replace function public.enviar_pedido(p_slug text, p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_mesa integer;
  v_mesa_ativa boolean;
  v_itens jsonb;
  v_total bigint;
begin
  select id into v_empresa from public.empresas where cardapio_slug = p_slug;
  if v_empresa is null then raise exception 'Cardápio indisponível.'; end if;
  if p_mesa is not null then
    select numero, ativo into v_mesa, v_mesa_ativa from public.mesas_cardapio
      where token = p_mesa and empresa_id = v_empresa for share;
    if not found then raise exception 'Mesa inválida.'; end if;
    if not v_mesa_ativa and not exists (
      select 1 from public.pedidos_online p
      where p.id = p_id and p.empresa_id = v_empresa and p.mesa = v_mesa
    ) then raise exception 'Mesa inativa.'; end if;
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
  from itens i join public.produtos p on p.id = i.produto_id and p.empresa_id = v_empresa and p.ativo and p.visivel_cardapio
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

commit;
