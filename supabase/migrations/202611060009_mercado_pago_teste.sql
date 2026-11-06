begin;

alter table public.pagamentos_online drop constraint pagamentos_online_ambiente_check;
alter table public.pagamentos_online add check (ambiente in ('producao','sandbox'));

insert into public.provedores_pagamento (empresa_id, provedor, ambiente, pix_habilitado)
select id, 'mercado_pago', 'sandbox', true from public.empresas where cardapio_slug = 'loja-teste';

create function public.reservar_pix_mercado_pago_teste(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended('loja-teste:mercado-pago', 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
      and e.cardapio_slug = 'loja-teste';
  if not found then
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite de testes Pix atingido.';
    end if;
    perform public.enviar_pedido('loja-teste', p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'sandbox', 'pix', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create function public.atualizar_pix_mercado_pago_teste(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = 'loja-teste'
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
      and pg.meio = 'pix' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;

revoke execute on function public.reservar_pix_mercado_pago_teste(uuid,text,uuid,jsonb),
  public.atualizar_pix_mercado_pago_teste(uuid,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.reservar_pix_mercado_pago_teste(uuid,text,uuid,jsonb),
  public.atualizar_pix_mercado_pago_teste(uuid,text,bigint,boolean) to service_role;

commit;
