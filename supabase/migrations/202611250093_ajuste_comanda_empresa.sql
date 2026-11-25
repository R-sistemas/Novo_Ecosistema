begin;

create function public.resolver_ajuste_comanda(p_empresa uuid,p_id uuid,p_aplicar boolean,p_resolucao text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform p.id from public.pedidos_online p
    join public.ajustes_comanda a on a.pedido_id=p.id
    where a.id=p_id and p.empresa_id=p_empresa
      and exists(select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid())
    for update of p;
  if not found then raise exception 'Solicitação indisponível.' using errcode='42501'; end if;
  perform public.resolver_ajuste_comanda(p_id,p_aplicar,p_resolucao);
end;
$$;

revoke all on function public.resolver_ajuste_comanda(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.resolver_ajuste_comanda(uuid,uuid,boolean,text) to authenticated;

commit;
