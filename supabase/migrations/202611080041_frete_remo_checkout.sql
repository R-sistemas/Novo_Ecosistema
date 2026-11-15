begin;

alter table public.entregas_pedido
  add column if not exists frete_centavos bigint not null default 0
  check (frete_centavos >= 0);

create function public.reservar_pix_entrega_frete_quiosque(
  p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
  v_pagamento public.pagamentos_online;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('quiosque-dorafa:mercado-pago', 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id and provedor = 'mercado_pago' and ambiente = 'producao';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos, 'cobranca', v_pagamento.cobranca_id);
end;
$$;
revoke execute on function public.reservar_pix_entrega_frete_quiosque(uuid,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.reservar_pix_entrega_frete_quiosque(uuid,text,jsonb,jsonb,bigint) to service_role;

create function public.reservar_pix_entrega_frete_teste(
  p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('loja-teste:mercado-pago', 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos
    where pedido_id = p_id and ambiente = 'sandbox';
  return jsonb_set(v_reserva, '{total_centavos}', to_jsonb((v_reserva->>'total_centavos')::bigint + p_frete_centavos));
end;
$$;
revoke execute on function public.reservar_pix_entrega_frete_teste(uuid,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.reservar_pix_entrega_frete_teste(uuid,text,jsonb,jsonb,bigint) to service_role;

create function public.enviar_pedido_pagamento_na_entrega_com_frete(
  p_slug text, p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_habilitado boolean;
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  select id, pagamento_na_entrega into v_empresa, v_habilitado
    from public.empresas where cardapio_slug = p_slug for share;
  if v_empresa is null then raise exception 'Cardápio indisponível.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 4));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
    if v_existente.pagamento <> 'na_entrega' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.enviar_pedido(p_slug, p_id, p_cliente, null, p_itens);
  end if;
  if not v_habilitado then raise exception 'Este estabelecimento não oferece pagamento na entrega.'; end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then raise exception 'Identificador de pedido já utilizado.'; end if;

  perform public.enviar_pedido(p_slug, p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'na_entrega', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  return p_id;
end;
$$;
revoke execute on function public.enviar_pedido_pagamento_na_entrega_com_frete(text,uuid,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.enviar_pedido_pagamento_na_entrega_com_frete(text,uuid,text,jsonb,jsonb,bigint) to service_role;

commit;
notify pgrst, 'reload schema';
