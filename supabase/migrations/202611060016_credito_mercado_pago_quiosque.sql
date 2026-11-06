begin;
create function public.reservar_credito_mercado_pago_quiosque(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended('quiosque-dorafa:mercado-pago', 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and pg.meio = 'credito' and e.cardapio_slug = 'quiosque-dorafa';
  if not found then
    if not exists (select 1 from public.provedores_pagamento c join public.empresas e on e.id = c.empresa_id
      where e.cardapio_slug = 'quiosque-dorafa' and c.provedor = 'mercado_pago'
        and c.ambiente = 'producao' and c.credito_habilitado) then
      raise exception 'Crédito online indisponível.';
    end if;
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite temporário de pagamentos atingido.';
    end if;
    perform public.enviar_pedido('quiosque-dorafa', p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'producao', 'credito', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create function public.atualizar_credito_mercado_pago_quiosque(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = 'quiosque-dorafa'
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and pg.meio = 'credito' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;

revoke execute on function public.reservar_credito_mercado_pago_quiosque(uuid,text,uuid,jsonb),
  public.atualizar_credito_mercado_pago_quiosque(uuid,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.reservar_credito_mercado_pago_quiosque(uuid,text,uuid,jsonb),
  public.atualizar_credito_mercado_pago_quiosque(uuid,text,bigint,boolean) to service_role;



create function public.recusar_credito_mercado_pago_quiosque(p_pedido uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos_online p set estado = 'recusado'
    from public.pagamentos_online pg, public.empresas e
    where p.id = p_pedido and p.estado = 'novo' and pg.pedido_id = p.id
      and e.id = p.empresa_id and e.id = pg.empresa_id and e.cardapio_slug = 'quiosque-dorafa'
      and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao' and pg.meio = 'credito'
      and pg.cobranca_id is null and pg.confirmado_em is null;
  return found;
end;
$$;

revoke execute on function public.recusar_credito_mercado_pago_quiosque(uuid) from public, anon, authenticated;
grant execute on function public.recusar_credito_mercado_pago_quiosque(uuid) to service_role;

commit;

