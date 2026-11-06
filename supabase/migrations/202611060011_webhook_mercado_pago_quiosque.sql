begin;
create function public.atualizar_pix_mercado_pago_quiosque(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = 'quiosque-dorafa'
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and pg.meio = 'pix' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;


revoke execute on function public.atualizar_pix_mercado_pago_quiosque(uuid,text,bigint,boolean) from public, anon, authenticated;
grant execute on function public.atualizar_pix_mercado_pago_quiosque(uuid,text,bigint,boolean) to service_role;
commit;
