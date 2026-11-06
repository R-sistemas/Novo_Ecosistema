begin;

alter table public.pedidos_online add column pix_sandbox_solicitado boolean not null default false;
update public.pedidos_online set pix_sandbox_solicitado = true where pix_sandbox_cobranca_id is not null;
grant update (pix_sandbox_solicitado) on public.pedidos_online to service_role;

create function public.iniciar_checkout_pix_sandbox(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pedido public.pedidos_online;
  v_criar boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 1));
  select * into v_pedido from public.pedidos_online where id = p_id;
  v_criar := not found;
  if v_criar then
    perform pg_advisory_xact_lock(hashtextextended('loja-teste:checkout-pix', 1));
    if (select count(*) from public.pedidos_online where pix_sandbox_solicitado
        and criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite de testes Pix atingido. Tente novamente mais tarde.';
    end if;
    perform public.enviar_pedido('loja-teste',p_id,p_cliente,p_mesa,p_itens);
    update public.pedidos_online set pix_sandbox_solicitado = true
      where id = p_id returning * into v_pedido;
  elsif not v_pedido.pix_sandbox_solicitado or not exists (
    select 1 from public.empresas e where e.id = v_pedido.empresa_id and e.cardapio_slug = 'loja-teste'
  ) then
    raise exception 'Identificador indisponível para Pix Sandbox.';
  end if;
  return jsonb_build_object('criar',v_criar,'total_centavos',v_pedido.total_centavos,
    'cobranca',v_pedido.pix_sandbox_cobranca_id);
end;
$$;

revoke execute on function public.iniciar_checkout_pix_sandbox(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.iniciar_checkout_pix_sandbox(uuid,text,uuid,jsonb),
  public.enviar_pedido(text,uuid,text,uuid,jsonb) to service_role;

create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null,
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null)
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  where e.cardapio_slug = p_slug and p.id = p_id;
$$;

create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.itens, p.total_centavos, p.estado, p.criado_em,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null) as recebido, p.pix_sandbox_confirmado_em is not null as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    where p.empresa_id = p_empresa
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and (p.estado in ('novo','preparo','pronto')
        or (p.estado = 'entregue' and v.id is null and p.pix_sandbox_confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;

create or replace function public.avancar_pedido(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pedido public.pedidos_online;
begin
  select p.* into v_pedido from public.pedidos_online p
  where p.id = p_id and exists (select 1 from public.membros m
    where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid())
  for update;
  if not found then raise exception 'Pedido indisponível.'; end if;
  if (v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null) and v_pedido.pix_sandbox_confirmado_em is null then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if p_estado = 'entregue' and v_pedido.pix_sandbox_confirmado_em is null and not exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Registre o recebimento antes de entregar.'; end if;
  if p_estado = 'recusado' and exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Pedido recebido no caixa. Confira o pagamento antes de recusar.'; end if;
  update public.pedidos_online p set estado = p_estado where p.id = p_id
    and ((p.estado = 'novo' and p_estado in ('preparo', 'recusado'))
      or (p.estado = 'preparo' and p_estado = 'pronto')
      or (p.estado = 'pronto' and p_estado = 'entregue'));
  if not found then raise exception 'Transição inválida.'; end if;
end;
$$;

create or replace function public.receber_pedido_no_caixa(p_caixa uuid, p_pedido uuid, p_meio text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_pedido public.pedidos_online;
  v_total bigint;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  select * into v_pedido from public.pedidos_online
  where id = p_pedido and empresa_id = v_caixa.empresa_id
  for update;
  if not found or v_pedido.estado = 'recusado' then
    raise exception 'Pedido indisponível.';
  end if;
  if v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null then raise exception 'Pedido vinculado ao Pix Sandbox.'; end if;
  v_total := public.registrar_venda(p_caixa, p_pedido, p_meio, v_pedido.itens);
  if v_total is distinct from v_pedido.total_centavos or exists (
    select 1 from jsonb_to_recordset(v_pedido.itens)
      as item(produto_id uuid, preco_centavos bigint)
    join public.itens_venda v on v.venda_id = p_pedido and v.produto_id = item.produto_id
    where v.preco_centavos <> item.preco_centavos
  ) then
    raise exception 'O preço do catálogo mudou. Confira o pedido antes de receber.';
  end if;
  return v_total;
end;
$$;

commit;
