begin;

create table public.equipe_kds (
  empresa_id uuid not null references public.empresas(id),
  usuario_id uuid not null references auth.users(id),
  primary key (empresa_id,usuario_id)
);
alter table public.equipe_kds enable row level security;
revoke all on public.equipe_kds from public,anon,authenticated;

create function public.pode_operar_cozinha(p_empresa uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid())
    or exists(select 1 from public.equipe_kds where empresa_id=p_empresa and usuario_id=auth.uid());
$$;
revoke execute on function public.pode_operar_cozinha(uuid) from public,anon,authenticated;

create function public.lojas_kds()
returns table(id uuid,nome text) language sql stable security definer set search_path = '' as $$
  select e.id,e.nome from public.empresas e join public.equipe_kds k on k.empresa_id=e.id
    where k.usuario_id=auth.uid() order by e.nome;
$$;
revoke execute on function public.lojas_kds() from public,anon;
grant execute on function public.lojas_kds() to authenticated;

create function public.vincular_novo_usuario_kds(p_gestor uuid,p_empresa uuid,p_operador uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.membros where empresa_id=p_empresa and usuario_id=p_gestor and papel='gestor' for share;
  if not found then raise exception 'Acesso administrativo indisponível.' using errcode='42501'; end if;
  insert into public.equipe_kds(empresa_id,usuario_id) values(p_empresa,p_operador);
end;
$$;
revoke execute on function public.vincular_novo_usuario_kds(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.vincular_novo_usuario_kds(uuid,uuid,uuid) to service_role;
create or replace function public.avancar_pedido(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pedido public.pedidos_online;
begin
  select p.* into v_pedido from public.pedidos_online p
  where p.id = p_id and public.pode_operar_cozinha(p.empresa_id)
  for update;
  if not found then raise exception 'Pedido indisponível.'; end if;
  if (v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null) and v_pedido.pix_sandbox_confirmado_em is null then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is null) then raise exception 'Pedido aguarda confirmação Pix.'; end if;
  if p_estado = 'entregue' and v_pedido.mesa is null and v_pedido.pix_sandbox_confirmado_em is null and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id and pg.confirmado_em is not null) and not exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  ) then raise exception 'Registre o recebimento antes de entregar.'; end if;
  if p_estado = 'recusado' and (v_pedido.pix_sandbox_confirmado_em is not null or exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_id) or exists (
    select 1 from public.vendas v where v.id = p_id and v.empresa_id = v_pedido.empresa_id
  )) then raise exception 'Confira o pagamento antes de recusar.'; end if;
  update public.pedidos_online p set estado = p_estado where p.id = p_id
    and ((p.estado = 'novo' and p_estado in ('preparo', 'recusado'))
      or (p.estado = 'preparo' and p_estado = 'pronto')
      or (p.estado = 'pronto' and p_estado = 'entregue'));
  if not found then raise exception 'Transição inválida.'; end if;
end;
$$;

create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(case when exists (select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()) then to_jsonb(fila) else to_jsonb(fila) - array['endereco_entrega','total_centavos'] end order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.comanda, (case when exists (select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()) then p.itens else (select jsonb_agg(i - array['preco_centavos','produto_id']) from jsonb_array_elements(p.itens) i) end) as itens, p.total_centavos, p.estado, p.criado_em, d.pagamento as pagamento_entrega, d.endereco as endereco_entrega,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null) as recebido, (p.pix_sandbox_confirmado_em is not null or (pg.ambiente = 'sandbox' and pg.confirmado_em is not null)) is true as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    left join public.pagamentos_online pg on pg.pedido_id = p.id
    left join public.entregas_pedido d on d.pedido_id = p.id
    where p.empresa_id = p_empresa and (pg.pedido_id is null or pg.confirmado_em is not null)
      and public.pode_operar_cozinha(p_empresa)
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and (p.estado in ('novo','preparo','pronto')
        or (p.estado = 'entregue' and p.mesa is null and v.id is null and p.pix_sandbox_confirmado_em is null and pg.confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;


commit;
