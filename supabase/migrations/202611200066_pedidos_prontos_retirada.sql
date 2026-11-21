begin;

create function public.pedidos_prontos_retirada(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'comanda',q.comanda,'mesa',q.mesa,'estado',q.estado,'criado_em',q.criado_em,
      'itens',coalesce((
        select jsonb_agg(jsonb_build_object('quantidade',i.item->'quantidade','nome',i.item->>'nome') order by i.pos)
        from jsonb_array_elements(q.itens) with ordinality i(item,pos)
      ),'[]'::jsonb)
    ) order by q.criado_em,q.id)
    from (
      select m.id,m.comanda,m.mesa,m.estado,m.criado_em,p.itens
      from painel_privado.monitor_pedidos m
      join public.pedidos_online p on p.id=m.id and p.empresa_id=m.empresa_id
      where m.empresa_id=e.id and m.mesa is not null and m.estado='pronto'
        and m.entrega is null and not m.sandbox
    ) q
  ),'[]'::jsonb)
  from public.empresas e where e.cardapio_slug=p_slug;
$$;

revoke all on function public.pedidos_prontos_retirada(text) from public,anon,authenticated,service_role;
grant execute on function public.pedidos_prontos_retirada(text) to anon,authenticated;

commit;
