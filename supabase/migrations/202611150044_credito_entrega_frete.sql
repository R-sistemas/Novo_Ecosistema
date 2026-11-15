begin;

create function public.reservar_credito_entrega_frete_quiosque(
  p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
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
    return public.reservar_credito_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  perform public.reservar_credito_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id
    and provedor = 'mercado_pago' and ambiente = 'producao' and meio = 'credito';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

revoke execute on function public.reservar_credito_entrega_frete_quiosque(uuid,text,jsonb,jsonb,bigint)
  from public, anon, authenticated;
grant execute on function public.reservar_credito_entrega_frete_quiosque(uuid,text,jsonb,jsonb,bigint)
  to service_role;

commit;
notify pgrst, 'reload schema';
