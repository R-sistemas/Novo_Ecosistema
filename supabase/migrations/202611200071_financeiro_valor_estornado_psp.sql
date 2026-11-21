begin;

alter table painel_privado.financeiro_eventos_psp add column estornado_centavos bigint
  check (estornado_centavos is null or (estornado_centavos >= 0 and valor_centavos is not null and estornado_centavos <= valor_centavos));
create index financeiro_eventos_psp_cobranca_data on painel_privado.financeiro_eventos_psp
  (empresa_id, provedor, ambiente, cobranca_id, ocorrido_em desc, evento_id desc);

drop function public.registrar_evento_financeiro_psp(uuid,text,text,text,text,text,bigint,timestamptz);
create function public.registrar_evento_financeiro_psp(
  p_pedido uuid, p_provedor text, p_ambiente text, p_cobranca text, p_evento text,
  p_estado text, p_valor bigint, p_ocorrido_em timestamptz, p_estornado bigint default null
)
returns boolean language sql volatile security definer set search_path = '' as $$
  with gravado as (
    insert into painel_privado.financeiro_eventos_psp (
      empresa_id, provedor, ambiente, cobranca_id, evento_id, ocorrido_em, estado, valor_centavos, estornado_centavos
    )
    select pg.empresa_id, pg.provedor, pg.ambiente, pg.cobranca_id, p_evento,
      coalesce(p_ocorrido_em, statement_timestamp()), p_estado, p_valor, p_estornado
    from public.pagamentos_online pg
    join public.pedidos_online p on p.id = pg.pedido_id and p.empresa_id = pg.empresa_id
    where pg.pedido_id = p_pedido and pg.provedor = p_provedor and pg.ambiente = p_ambiente
      and pg.cobranca_id = p_cobranca and btrim(pg.cobranca_id) <> ''
      and length(p_evento) between 1 and 128
    on conflict (empresa_id, provedor, ambiente, evento_id) do nothing
    returning 1
  )
  select exists(select 1 from gravado);
$$;

revoke all on function public.registrar_evento_financeiro_psp(uuid,text,text,text,text,text,bigint,timestamptz,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.registrar_evento_financeiro_psp(uuid,text,text,text,text,text,bigint,timestamptz,bigint)
  to service_role;

commit;
