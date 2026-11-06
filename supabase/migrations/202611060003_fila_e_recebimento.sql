begin;

create function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.itens, p.total_centavos, p.estado, p.criado_em,
      v.id is not null as recebido
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    where p.empresa_id = p_empresa
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and (p.estado in ('novo','preparo','pronto') or (p.estado = 'entregue' and v.id is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;

revoke execute on function public.fila_cozinha(uuid) from public, anon, authenticated;
grant execute on function public.fila_cozinha(uuid) to authenticated;

create or replace function public.avancar_pedido(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pedido public.pedidos_online;
begin
  select p.* into v_pedido from public.pedidos_online p
  where p.id = p_id and exists (select 1 from public.membros m
    where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid())
  for update;
  if not found then raise exception 'Pedido indisponível.'; end if;
  if p_estado = 'entregue' and not exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Registre o recebimento antes de entregar.'; end if;
  if p_estado = 'recusado' and exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Pedido recebido no caixa. Confira o pagamento antes de recusar.'; end if;
  update public.pedidos_online p set estado = p_estado where p.id = p_id
    and ((p.estado = 'novo' and p_estado in ('preparo', 'recusado'))
      or (p.estado = 'preparo' and p_estado = 'pronto')
      or (p.estado = 'pronto' and p_estado = 'entregue'));
  if not found then raise exception 'Transição inválida.'; end if;
end;
$$;

commit;
