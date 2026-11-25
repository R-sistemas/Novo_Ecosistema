begin;

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

  select case when sandbox_checkout then 'sandbox' else 'producao' end
    into v_ambiente from public.empresas where id = v_pedido.empresa_id;
  if v_ambiente = 'producao' then
    insert into remo.tentativas_despacho (pedido_id, estado) values (p_pedido, 'confirmando')
      on conflict (pedido_id) do update set estado = excluded.estado, atualizado_em = now();
  end if;
  return jsonb_build_object(
    'empresa', v_pedido.empresa_id, 'numero_pedido', v_pedido.comanda,
    'ambiente', v_ambiente,
    'cliente', v_pedido.cliente,
    'endereco', v_entrega.endereco,
    'cobrar_centavos', case when v_entrega.pagamento = 'na_entrega' and not exists (
      select 1 from public.vendas where id = p_pedido and empresa_id = v_pedido.empresa_id
    ) then v_pedido.total_centavos else 0 end
  );
end;
$$;

create or replace function public.solicitar_despacho_remo(p_pedido uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pedido public.pedidos_online;
  v_entrega public.entregas_pedido;
  v_solicitacao uuid;
begin
  select p.* into v_pedido from public.pedidos_online p
    where p.id = p_pedido and exists (
      select 1 from public.membros m where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid()
    ) for update;
  if not found then raise exception 'Pedido indisponível.'; end if;

  select id into v_solicitacao from remo.solicitacoes
    where origem = 'r_sistemas' and solicitante = v_pedido.empresa_id and referencia = p_pedido::text;
  if found then return v_solicitacao; end if;
  if not exists (select 1 from public.empresas where id = v_pedido.empresa_id and sandbox_checkout) then
    raise exception 'Atualize o PDV para solicitar o despacho pela REMO.';
  end if;
  if public.ajuste_comanda_pendente(p_pedido) then raise exception 'Resolva o ajuste antes de despachar.'; end if;
  if exists(select 1 from public.adicionais_comanda where pedido_id=p_pedido and estado in ('novo','preparo')) then
    raise exception 'Conclua os adicionais antes de despachar.';
  end if;
  if v_pedido.estado <> 'pronto' then raise exception 'O pedido precisa estar pronto para despacho.'; end if;
  select * into v_entrega from public.entregas_pedido where pedido_id = p_pedido;
  if not found then raise exception 'Pedido sem endereço de entrega.'; end if;
  if v_entrega.pagamento = 'online' and not exists (
    select 1 from public.pagamentos_online where pedido_id = p_pedido and confirmado_em is not null
  ) then raise exception 'Pedido aguarda confirmação do pagamento.'; end if;

  insert into remo.solicitacoes (origem, ambiente, referencia, solicitante, destino, cobrar_na_entrega_centavos)
    values ('r_sistemas', case when exists (select 1 from public.empresas
      where id = v_pedido.empresa_id and sandbox_checkout) then 'sandbox' else 'producao' end,
      p_pedido::text, v_pedido.empresa_id, v_entrega.endereco,
      case when v_entrega.pagamento = 'na_entrega' and not exists (
        select 1 from public.vendas where id = p_pedido and empresa_id = v_pedido.empresa_id
      ) then v_pedido.total_centavos else 0 end)
    returning id into v_solicitacao;
  return v_solicitacao;
end;
$$;

commit;