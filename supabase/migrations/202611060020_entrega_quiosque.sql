begin;
create function public.reservar_pix_entrega_quiosque(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_reserva jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('quiosque-dorafa:mercado-pago', 3));
  if exists (select 1 from public.pedidos_online where id = p_id)
     and not exists (select 1 from public.entregas_pedido where pedido_id = p_id
        and pagamento = 'online' and endereco = v_endereco) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento)
    values (p_id, v_endereco, 'online') on conflict (pedido_id) do nothing;
  return v_reserva;
end;
$$;


revoke execute on function public.reservar_pix_entrega_quiosque(uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.reservar_pix_entrega_quiosque(uuid,text,jsonb,jsonb) to service_role;
create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.itens, p.total_centavos, p.estado, p.criado_em, d.pagamento as pagamento_entrega, d.endereco as endereco_entrega,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null) as recebido, (p.pix_sandbox_confirmado_em is not null or (pg.ambiente = 'sandbox' and pg.confirmado_em is not null)) is true as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    left join public.pagamentos_online pg on pg.pedido_id = p.id
    left join public.entregas_pedido d on d.pedido_id = p.id
    where p.empresa_id = p_empresa and (pg.pedido_id is null or pg.confirmado_em is not null)
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and (p.estado in ('novo','preparo','pronto')
        or (p.estado = 'entregue' and v.id is null and p.pix_sandbox_confirmado_em is null and pg.confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;

commit;


