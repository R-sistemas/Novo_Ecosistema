begin;
create or replace function public.acompanhar_pedido(p_slug text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('estado', p.estado, 'total_centavos', p.total_centavos,
    'pix_sandbox', p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or coalesce(pg.ambiente = 'sandbox', false),
    'pix_confirmado', p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null, 'pix_producao', coalesce(pg.ambiente = 'producao', false))
  from public.pedidos_online p join public.empresas e on e.id = p.empresa_id
  left join public.pagamentos_online pg on pg.pedido_id = p.id where e.cardapio_slug = p_slug and p.id = p_id;
$$;

create or replace function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(fila) order by fila.criado_em, fila.id), '[]'::jsonb)
  from (
    select p.id, p.cliente, p.mesa, p.itens, p.total_centavos, p.estado, p.criado_em,
      (v.id is not null or p.pix_sandbox_confirmado_em is not null or pg.confirmado_em is not null) as recebido, (p.pix_sandbox_confirmado_em is not null or (pg.ambiente = 'sandbox' and pg.confirmado_em is not null)) is true as pix_teste
    from public.pedidos_online p
    left join public.vendas v on v.id = p.id and v.empresa_id = p.empresa_id
    left join public.pagamentos_online pg on pg.pedido_id = p.id
    where p.empresa_id = p_empresa and (pg.pedido_id is null or pg.confirmado_em is not null)
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and ((not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null) or p.pix_sandbox_confirmado_em is not null)
      and (p.estado in ('novo','preparo','pronto')
        or (p.estado = 'entregue' and v.id is null and p.pix_sandbox_confirmado_em is null and pg.confirmado_em is null))
    order by p.criado_em, p.id
    limit 100
  ) fila;
$$;

commit;
