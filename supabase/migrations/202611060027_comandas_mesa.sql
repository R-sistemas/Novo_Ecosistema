begin;
alter table public.pedidos_online add column comanda bigint generated always as identity unique;
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
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is null) then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if p_estado = 'entregue' and v_pedido.mesa is null and v_pedido.pix_sandbox_confirmado_em is null and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is not null) and not exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Registre o recebimento antes de entregar.'; end if;
  if p_estado = 'recusado' and (v_pedido.pix_sandbox_confirmado_em is not null or exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id) or exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  )) then raise exception 'Confira o pagamento antes de recusar.'; end if;
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
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_pedido) then raise exception 'Pedido com pagamento online.'; end if;
  if v_pedido.mesa is not null then
    if v_pedido.estado <> 'entregue' then raise exception 'A comanda ainda não foi entregue.'; end if;
    if p_meio is null or p_meio not in ('dinheiro','pix','cartao') then raise exception 'Meio de pagamento inválido.'; end if;
    if exists (select 1 from public.vendas where id=p_pedido) then
      select total_centavos into v_total from public.vendas where id=p_pedido
        and caixa_id=p_caixa and empresa_id=v_caixa.empresa_id and meio=p_meio;
      if not found then raise exception 'Comanda já recebida.'; end if;
      return v_total;
    end if;
    if v_caixa.fechado_em is not null then raise exception 'Caixa fechado.'; end if;
    insert into public.vendas(id,caixa_id,empresa_id,total_centavos,meio)
      values(p_pedido,p_caixa,v_caixa.empresa_id,v_pedido.total_centavos,p_meio);
    insert into public.itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos)
      select p_pedido,i.produto_id,i.nome,i.quantidade,i.preco_centavos
      from jsonb_to_recordset(v_pedido.itens) i(produto_id uuid,nome text,quantidade integer,preco_centavos bigint);
    insert into public.movimentos_caixa(empresa_id,caixa_id,tipo,valor_centavos,meio)
      values(v_caixa.empresa_id,p_caixa,'venda',v_pedido.total_centavos,p_meio);
    return v_pedido.total_centavos;
  end if;
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


create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.comanda, p.itens, p.total_centavos, p.estado, p.criado_em, d.pagamento as pagamento_entrega, d.endereco as endereco_entrega,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null) as recebido, (p.pix_sandbox_confirmado_em is not null or (pg.ambiente = 'sandbox' and pg.confirmado_em is not null)) is true as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    left join public.pagamentos_online pg on pg.pedido_id = p.id
    left join public.entregas_pedido d on d.pedido_id = p.id
    where p.empresa_id = p_empresa and (pg.pedido_id is null or pg.confirmado_em is not null)
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and (p.estado in ('novo','preparo','pronto')
        or (p.estado = 'entregue' and p.mesa is null and v.id is null and p.pix_sandbox_confirmado_em is null and pg.confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;


create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'mesa', p.mesa, 'comanda', p.comanda, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or coalesce(pg.ambiente = 'sandbox', false),
    'pago', v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null,
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null, 'pix_producao', coalesce(pg.ambiente = 'producao', false))
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
  left join public.pagamentos_online pg on pg.pedido_id = p.id where e.cardapio_slug = p_slug and p.id = p_id;
$$;


create function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos
    from public.pedidos_online p
    where p.empresa_id = p_empresa and p.mesa is not null and p.estado = 'entregue'
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and not exists (select 1 from public.vendas v where v.id = p.id and v.empresa_id = p_empresa)
      and not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null
      and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id = p.id)
      and (btrim(p_busca) = '' or p.mesa::text = btrim(p_busca) or p.comanda::text = btrim(p_busca))
    order by p.comanda limit 100
  ) c;
$$;
revoke execute on function public.comandas_pendentes(uuid,text) from public, anon;
grant execute on function public.comandas_pendentes(uuid,text) to authenticated;

create function public.configurar_mesa_cardapio(p_empresa uuid,p_numero integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token uuid; v_slug text;
begin
  select e.cardapio_slug into v_slug from public.empresas e
    where e.id=p_empresa and exists (select 1 from public.membros m where m.empresa_id=e.id
      and m.usuario_id=auth.uid() and m.papel='gestor');
  if v_slug is null then raise exception 'Cardápio indisponível para configuração.' using errcode='42501'; end if;
  if p_numero is null or p_numero not between 1 and 999 then raise exception 'Informe uma mesa entre 1 e 999.'; end if;
  insert into public.mesas_cardapio(empresa_id,numero) values(p_empresa,p_numero)
    on conflict (empresa_id,numero) do nothing;
  select token into v_token from public.mesas_cardapio where empresa_id=p_empresa and numero=p_numero;
  return jsonb_build_object('loja',v_slug,'mesa',v_token);
end;
$$;
revoke execute on function public.configurar_mesa_cardapio(uuid,integer) from public, anon;
grant execute on function public.configurar_mesa_cardapio(uuid,integer) to authenticated;
commit;
