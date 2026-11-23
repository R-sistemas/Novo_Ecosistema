begin;

create function painel_privado.proteger_integracao_mp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.integracao_mp is not null and old.integracao_mp is distinct from new.integracao_mp then
    raise exception using errcode='42501',message='Vínculo de recebedor imutável';
  end if;
  if old.integracao_mp is not null and
    current_setting('painel.integracao_mp',true) is distinct from old.integracao_mp::text then
    raise exception using errcode='42501',message='Conciliação exige integração da cobrança';
  end if;
  return new;
end;
$$;
create trigger proteger_integracao_mp_pedido before update of integracao_mp,cobranca_id,confirmado_em
  on public.pagamentos_online for each row execute function painel_privado.proteger_integracao_mp();
create trigger proteger_integracao_mp_pdv before update of integracao_mp,ordem_id,estado
  on public.pix_frente_caixa for each row execute function painel_privado.proteger_integracao_mp();

create function public.servico_mp_reserva_pdv(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_slug text;
  v_pix public.pix_frente_caixa;
  v_integracao uuid;
  v_legado boolean;
begin
  select e.id,e.cardapio_slug into v_empresa,v_slug from public.empresas e
    join public.caixas c on c.empresa_id=e.id join public.pix_frente_caixa x on x.caixa_id=c.id
    where x.id=p_id for update of e;
  if not found then return jsonb_build_object('bloqueada',true); end if;
  select * into strict v_pix from public.pix_frente_caixa where id=p_id for update;
  v_integracao := v_pix.integracao_mp;
  if v_integracao is null and v_pix.ordem_id is null and not v_pix.legado_mp then
    select id into v_integracao from painel_privado.credenciais_mp
      where empresa_id=v_empresa and ambiente=v_pix.ambiente and estado='ativa';
    if v_integracao is not null then
      update public.pix_frente_caixa set integracao_mp=v_integracao where id=p_id;
    end if;
  end if;
  if v_integracao is not null then return painel_privado.mp_envelope_runtime(v_integracao); end if;
  v_legado := exists(select 1 from painel_privado.mp_legado_empresa where empresa_id=v_empresa and ambiente=v_pix.ambiente and slug=v_slug) and (v_pix.ordem_id is not null or not exists(select 1 from painel_privado.credenciais_mp
    where empresa_id=v_empresa and ambiente=v_pix.ambiente and estado='revogada'));
  if coalesce(v_legado,false) and not v_pix.legado_mp then update public.pix_frente_caixa set legado_mp=true where id=p_id; end if;
  return jsonb_build_object('legado',coalesce(v_legado,false));
end;
$$;

create function public.servico_mp_conciliar_pdv(
  p_integracao uuid,p_id uuid,p_ordem text,p_valor bigint,p_ambiente text,p_estado text
) returns text language plpgsql security definer set search_path = '' as $$
begin
  select x.integracao_mp into p_integracao from public.pix_frente_caixa x
  join public.caixas ca on ca.id=x.caixa_id
  join painel_privado.credenciais_mp original on original.id=x.integracao_mp
  join painel_privado.credenciais_mp origem on origem.id=p_integracao
    and (origem.empresa_id,origem.ambiente,origem.recebedor)=(original.empresa_id,original.ambiente,original.recebedor)
  where x.id=p_id and original.empresa_id=ca.empresa_id and original.ambiente=p_ambiente;
  if not found then raise exception using errcode='42501',message='Recebedor incompatível'; end if;
  perform set_config('painel.integracao_mp',p_integracao::text,true);
  return public.conciliar_pix_frente(p_id,p_ordem,p_valor,p_ambiente,p_estado);
end;
$$;

create or replace function public.ambiente_pix_frente(p_empresa uuid)
returns text language sql stable security definer set search_path='' as $$
  select pg.ambiente from public.provedores_pagamento pg join public.empresas e on e.id=pg.empresa_id
  where pg.empresa_id=p_empresa and pg.provedor='mercado_pago' and pg.pix_habilitado
    and (exists(select 1 from painel_privado.credenciais_mp c
      where c.empresa_id=e.id and c.ambiente=pg.ambiente and c.estado='ativa')
    or exists(select 1 from painel_privado.mp_legado_empresa m where m.empresa_id=e.id and m.ambiente=pg.ambiente and m.slug=e.cardapio_slug)
      and not exists(select 1 from painel_privado.credenciais_mp c
        where c.empresa_id=e.id and c.ambiente=pg.ambiente and c.estado='revogada'))
  order by (pg.ambiente='producao') desc limit 1;
$$;

create or replace function public.registrar_evento_financeiro_psp(
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
    where (pg.integracao_mp is null or pg.integracao_mp::text = current_setting('painel.integracao_mp',true))
      and pg.pedido_id = p_pedido and pg.provedor = p_provedor and pg.ambiente = p_ambiente
      and pg.cobranca_id = p_cobranca and btrim(pg.cobranca_id) <> ''
      and length(p_evento) between 1 and 128
    on conflict (empresa_id, provedor, ambiente, evento_id) do nothing
    returning 1
  )
  select exists(select 1 from gravado);
$$;

create function public.servico_mp_recusar_credito(p_integracao uuid,p_pedido uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pedidos_online p set estado='recusado' from public.pagamentos_online pg
    where pg.pedido_id=p_pedido and pg.pedido_id=p.id and pg.empresa_id=p.empresa_id
      and p.estado='novo' and pg.integracao_mp=p_integracao and pg.meio='credito'
      and pg.cobranca_id is null and pg.confirmado_em is null;
  return found;
end;
$$;

revoke all on function public.servico_mp_recusar_credito(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.servico_mp_recusar_credito(uuid,uuid) to service_role;

create function public.servico_mp_evento_financeiro(p_integracao uuid,p_evento jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  select pg.integracao_mp into p_integracao from public.pagamentos_online pg
  join painel_privado.credenciais_mp original on original.id=pg.integracao_mp
    and original.empresa_id=pg.empresa_id and original.ambiente=pg.ambiente
  join painel_privado.credenciais_mp origem on origem.id=p_integracao
    and (origem.empresa_id,origem.ambiente,origem.recebedor)=(original.empresa_id,original.ambiente,original.recebedor)
  where pg.pedido_id=(p_evento->>'p_pedido')::uuid and pg.provedor='mercado_pago'
      and pg.ambiente=p_evento->>'p_ambiente' and pg.cobranca_id=p_evento->>'p_cobranca';
  if not found then return false; end if;
  perform set_config('painel.integracao_mp',p_integracao::text,true);
  return public.registrar_evento_financeiro_psp((p_evento->>'p_pedido')::uuid,'mercado_pago',
    p_evento->>'p_ambiente',p_evento->>'p_cobranca',p_evento->>'p_evento',p_evento->>'p_estado',
    (p_evento->>'p_valor')::bigint,(p_evento->>'p_ocorrido_em')::timestamptz,(p_evento->>'p_estornado')::bigint);
end;
$$;

revoke all on function painel_privado.proteger_integracao_mp(),
  public.servico_mp_reserva_pdv(uuid),public.servico_mp_conciliar_pdv(uuid,uuid,text,bigint,text,text),
  public.servico_mp_evento_financeiro(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.servico_mp_reserva_pdv(uuid),
  public.servico_mp_conciliar_pdv(uuid,uuid,text,bigint,text,text),
  public.servico_mp_evento_financeiro(uuid,jsonb) to service_role;

commit;
