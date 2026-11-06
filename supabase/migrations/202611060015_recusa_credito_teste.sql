begin;

create function public.recusar_credito_mercado_pago_teste(p_pedido uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos_online p set estado = 'recusado'
    from public.pagamentos_online pg, public.empresas e
    where p.id = p_pedido and p.estado = 'novo' and pg.pedido_id = p.id
      and e.id = p.empresa_id and e.id = pg.empresa_id and e.cardapio_slug = 'loja-teste'
      and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox' and pg.meio = 'credito'
      and pg.cobranca_id is null and pg.confirmado_em is null;
  return found;
end;
$$;

revoke execute on function public.recusar_credito_mercado_pago_teste(uuid) from public, anon, authenticated;
grant execute on function public.recusar_credito_mercado_pago_teste(uuid) to service_role;

commit;
