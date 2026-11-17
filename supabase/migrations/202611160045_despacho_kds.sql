begin;

-- A cozinha pode concluir o preparo de uma loja mesmo sem pertencer à equipe do PDV.
-- O despacho usa a mesma autorização restrita e continua exigindo pedido pronto e pago.
create or replace function public.preparar_despacho_integrado(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pedido public.pedidos_online;
  v_entrega public.entregas_pedido;
  v_solicitacao remo.solicitacoes;
  v_ambiente text;
begin
  select p.* into v_pedido from public.pedidos_online p
    where p.id = p_pedido and public.pode_operar_cozinha(p.empresa_id) for update;
  if not found then raise exception 'Pedido indisponível.' using errcode = '42501'; end if;

  select * into v_solicitacao from remo.solicitacoes
    where origem = 'r_sistemas' and solicitante = v_pedido.empresa_id and referencia = p_pedido::text;
  if found then return jsonb_build_object('ja_solicitado', true); end if;

  if public.ajuste_comanda_pendente(p_pedido) then raise exception 'Resolva o ajuste antes de despachar.'; end if;
  if exists(select 1 from public.adicionais_comanda where pedido_id = p_pedido and estado in ('novo','preparo')) then
    raise exception 'Conclua os adicionais antes de despachar.';
  end if;
  if v_pedido.estado <> 'pronto' then raise exception 'O pedido precisa estar pronto para despacho.'; end if;
  select * into v_entrega from public.entregas_pedido where pedido_id = p_pedido;
  if not found then raise exception 'Pedido sem endereço de entrega.'; end if;
  if v_entrega.pagamento = 'online' and not exists (
    select 1 from public.pagamentos_online where pedido_id = p_pedido and confirmado_em is not null
  ) then raise exception 'Pedido aguarda confirmação do pagamento.'; end if;

  select case when cardapio_slug = 'loja-teste' then 'sandbox' else 'producao' end
    into v_ambiente from public.empresas where id = v_pedido.empresa_id;
  if v_ambiente = 'producao' then
    insert into remo.tentativas_despacho (pedido_id, estado) values (p_pedido, 'confirmando')
      on conflict (pedido_id) do update set estado = excluded.estado, atualizado_em = now();
  end if;
  return jsonb_build_object(
    'empresa', v_pedido.empresa_id,
    'ambiente', v_ambiente,
    'cliente', v_pedido.cliente,
    'endereco', v_entrega.endereco,
    'cobrar_centavos', case when v_entrega.pagamento = 'na_entrega' and not exists (
      select 1 from public.vendas where id = p_pedido and empresa_id = v_pedido.empresa_id
    ) then v_pedido.total_centavos else 0 end
  );
end;
$$;

commit;
