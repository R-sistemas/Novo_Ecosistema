begin;
insert into public.provedores_pagamento (empresa_id, provedor, ambiente, pix_habilitado)
select id, 'mercado_pago', 'producao', true from public.empresas where cardapio_slug = 'quiosque-dorafa';

create function public.reservar_pix_mercado_pago_quiosque(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended('quiosque-dorafa:mercado-pago', 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and e.cardapio_slug = 'quiosque-dorafa';
  if not found then
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite temporário de pedidos Pix atingido.';
    end if;
    perform public.enviar_pedido('quiosque-dorafa', p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'producao', 'pix', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;


revoke execute on function public.reservar_pix_mercado_pago_quiosque(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reservar_pix_mercado_pago_quiosque(uuid,text,uuid,jsonb) to service_role;
commit;
