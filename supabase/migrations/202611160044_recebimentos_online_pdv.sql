begin;

-- Pagamentos do cardápio pertencem à loja, inclusive quando nenhum caixa está aberto.
-- Esta consulta não cria uma segunda venda nem movimenta dinheiro do operador.
create function public.recebimentos_online_da_loja(p_empresa uuid, p_dia date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.membros m
    where m.empresa_id = p_empresa and m.usuario_id = auth.uid()) then
    raise exception 'Loja indisponível.' using errcode = '42501';
  end if;

  return (with base as (
    select p.comanda, p.estado, r.estado as estado_entrega, pg.meio,
      pg.valor_centavos, coalesce(d.frete_centavos, 0) as frete_centavos,
      pg.confirmado_em
    from public.pagamentos_online pg
    join public.pedidos_online p on p.id = pg.pedido_id and p.empresa_id = pg.empresa_id
    left join public.entregas_pedido d on d.pedido_id = p.id
    left join lateral (
      select s.estado from remo.solicitacoes s
      where s.origem = 'r_sistemas' and s.solicitante = p.empresa_id
        and s.referencia = p.id::text
      order by s.criada_em desc limit 1
    ) r on true
    where pg.empresa_id = p_empresa and pg.ambiente = 'producao'
      and pg.confirmado_em >= (p_dia::timestamp at time zone 'America/Sao_Paulo')
      and pg.confirmado_em < ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo')
  )
  select jsonb_build_object(
    'quantidade', count(*),
    'total_centavos', coalesce(sum(valor_centavos), 0),
    'frete_centavos', coalesce(sum(frete_centavos), 0),
    'pedidos', coalesce((select jsonb_agg(to_jsonb(ultimos) order by ultimos.confirmado_em desc)
      from (select * from base order by confirmado_em desc limit 30) ultimos), '[]'::jsonb)
  ) from base);
end;
$$;

revoke execute on function public.recebimentos_online_da_loja(uuid,date) from public, anon;
grant execute on function public.recebimentos_online_da_loja(uuid,date) to authenticated;

commit;
