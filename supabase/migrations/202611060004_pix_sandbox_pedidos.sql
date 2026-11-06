begin;

alter table public.pedidos_online
  add column pix_sandbox_cobranca_id text unique,
  add column pix_sandbox_confirmado_em timestamptz,
  add constraint pedido_pix_confirmado_com_cobranca
    check (pix_sandbox_confirmado_em is null or pix_sandbox_cobranca_id is not null);

alter table public.asaas_sandbox_eventos add column valor_centavos bigint
  check (valor_centavos > 0);

create index asaas_sandbox_eventos_por_cobranca
  on public.asaas_sandbox_eventos(cobranca_id);

create function public.confirmar_pix_sandbox(p_cobranca text)
returns void language sql set search_path = '' as $$
  update public.pedidos_online p
    set pix_sandbox_confirmado_em = e.recebido_em
  from (
    select valor_centavos, min(recebido_em) as recebido_em
    from public.asaas_sandbox_eventos
    where cobranca_id = p_cobranca and tipo = 'PAYMENT_RECEIVED'
    group by valor_centavos
  ) e
  where p.pix_sandbox_cobranca_id = p_cobranca and p.pix_sandbox_confirmado_em is null
    and p.total_centavos = e.valor_centavos;
$$;

create function public.registrar_evento_pix_sandbox(p_evento text, p_cobranca text, p_valor bigint)
returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cobranca, 0));
  insert into public.asaas_sandbox_eventos(evento_id,cobranca_id,tipo,valor_centavos)
    values(p_evento,p_cobranca,'PAYMENT_RECEIVED',p_valor)
    on conflict(evento_id) do nothing;
  perform public.confirmar_pix_sandbox(p_cobranca);
end;
$$;

create function public.vincular_pix_sandbox(p_pedido uuid, p_cobranca text, p_valor bigint)
returns void language plpgsql set search_path = '' as $$
begin
  if p_cobranca is null or p_cobranca !~ '^pay_[A-Za-z0-9]+$' then
    raise exception 'Cobrança inválida.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cobranca, 0));
  update public.pedidos_online p set pix_sandbox_cobranca_id = p_cobranca
  where p.id = p_pedido and p.estado = 'novo' and p.total_centavos = p_valor and exists (select 1 from public.empresas e where e.id = p.empresa_id and e.cardapio_slug = 'loja-teste')
    and (p.pix_sandbox_cobranca_id is null or p.pix_sandbox_cobranca_id = p_cobranca)
    and not exists (select 1 from public.vendas v where v.id = p.id);
  if not found then raise exception 'Pedido indisponível para vincular a cobrança.'; end if;
  perform public.confirmar_pix_sandbox(p_cobranca);
end;
$$;

revoke execute on function public.confirmar_pix_sandbox(text),
  public.registrar_evento_pix_sandbox(text,text,bigint),
  public.vincular_pix_sandbox(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.confirmar_pix_sandbox(text),
  public.registrar_evento_pix_sandbox(text,text,bigint),
  public.vincular_pix_sandbox(uuid,text,bigint) to service_role;
grant update (pix_sandbox_cobranca_id,pix_sandbox_confirmado_em) on public.pedidos_online to service_role;

grant select on public.pedidos_online, public.empresas, public.vendas to service_role;

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
      and (p.pix_sandbox_cobranca_id is null or p.pix_sandbox_confirmado_em is not null)
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
  if v_pedido.pix_sandbox_cobranca_id is not null and v_pedido.pix_sandbox_confirmado_em is null then raise exception 'Pedido aguarda confirmação Pix.'; end if;
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
  if v_pedido.pix_sandbox_cobranca_id is not null then raise exception 'Pedido vinculado ao Pix Sandbox.'; end if;
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
