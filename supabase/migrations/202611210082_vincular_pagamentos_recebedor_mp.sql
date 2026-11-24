begin;

alter table public.pagamentos_online add column integracao_mp uuid references painel_privado.credenciais_mp;
alter table public.pix_frente_caixa add column integracao_mp uuid references painel_privado.credenciais_mp;
alter table public.pix_frente_caixa add column legado_mp boolean not null default true;
alter table public.pix_frente_caixa alter column legado_mp set default false;
create table painel_privado.mp_legado_empresa (
  empresa_id uuid not null references public.empresas(id),
  ambiente text primary key check (ambiente in ('producao','sandbox')),
  slug text not null
);
insert into painel_privado.mp_legado_empresa(empresa_id,ambiente,slug)
  select id,case cardapio_slug when 'loja-teste' then 'sandbox' else 'producao' end,cardapio_slug
  from public.empresas where cardapio_slug in ('loja-teste','quiosque-dorafa');
alter table painel_privado.mp_legado_empresa enable row level security;
revoke all on painel_privado.mp_legado_empresa from public,anon,authenticated,service_role;

create index pagamentos_recebedor_mp on public.pagamentos_online(integracao_mp,cobranca_id)
  where integracao_mp is not null;
create index pix_caixa_recebedor_mp on public.pix_frente_caixa(integracao_mp,ordem_id)
  where integracao_mp is not null;

create function painel_privado.mp_envelope_runtime(p_integracao uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('integracao',c.id,'empresa',c.empresa_id,'recebedor',c.recebedor,
    'ambiente',c.ambiente,'estado',c.estado,'envelope',c.envelope,'envelope_atual',
    (select n.envelope from painel_privado.credenciais_mp n where n.empresa_id=c.empresa_id
      and n.ambiente=c.ambiente and n.recebedor=c.recebedor and n.estado='ativa')) from painel_privado.credenciais_mp c where c.id=p_integracao;
$$;

create function public.servico_integracao_mp_webhook(p_integracao uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select painel_privado.mp_envelope_runtime(p_integracao)
  where exists (select 1 from painel_privado.credenciais_mp where id=p_integracao and estado in ('ativa','pendente','historica','revogada'));
$$;

create function painel_privado.mp_reservar_legado(
  p_id uuid,p_cliente text,p_mesa uuid,p_itens jsonb,p_meio text,p_ambiente text,p_endereco jsonb,p_frete bigint
) returns jsonb language plpgsql set search_path='' as $$
declare
  v_reserva jsonb;
begin
  if p_ambiente='sandbox' then
    if p_endereco is not null and p_meio='pix' then
      v_reserva := public.reservar_pix_entrega_frete_teste(p_id,p_cliente,p_itens,p_endereco,p_frete);
    elsif p_meio='pix' then
      v_reserva := public.reservar_pix_mercado_pago_teste(p_id,p_cliente,p_mesa,p_itens);
    else
      v_reserva := public.reservar_credito_mercado_pago_teste(p_id,p_cliente,p_mesa,p_itens);
    end if;
  elsif p_endereco is not null then
    if p_meio='pix' then
      v_reserva := public.reservar_pix_entrega_frete_quiosque(p_id,p_cliente,p_itens,p_endereco,p_frete);
    else
      v_reserva := public.reservar_credito_entrega_frete_quiosque(p_id,p_cliente,p_itens,p_endereco,p_frete);
    end if;
  elsif p_meio='pix' then
    v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id,p_cliente,p_mesa,p_itens);
  else
    v_reserva := public.reservar_credito_mercado_pago_quiosque(p_id,p_cliente,p_mesa,p_itens);
  end if;
  return jsonb_build_object('legado',true,'pedido',v_reserva);
end;
$$;
revoke all on function painel_privado.mp_reservar_legado(uuid,text,uuid,jsonb,text,text,jsonb,bigint)
  from public,anon,authenticated,service_role;

create function public.servico_mp_reserva_pedido(
  p_slug text,p_id uuid,p_cliente text,p_mesa uuid,p_itens jsonb,p_meio text,p_ambiente text,
  p_endereco jsonb default null,p_frete bigint default null,p_legado boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_integracao uuid;
  v_pagamento public.pagamentos_online;
  v_entrega public.entregas_pedido;
  v_endereco jsonb;
  v_legado boolean;
begin
  if p_meio not in ('pix','credito') or p_ambiente not in ('producao','sandbox')
    or (p_endereco is not null and (p_mesa is not null or p_frete is null or p_frete < 0)) then
    raise exception using errcode='22023',message='Pedido inválido';
  end if;
  select id into v_empresa from public.empresas where cardapio_slug=p_slug for update;
  if not found then return jsonb_build_object('bloqueada',true); end if;
  v_legado := coalesce(p_legado,false) and exists(select 1 from painel_privado.mp_legado_empresa
    where empresa_id=v_empresa and ambiente=p_ambiente and slug=p_slug);
  select * into v_pagamento from public.pagamentos_online where pedido_id=p_id for update;
  if found then
    if (v_pagamento.empresa_id,v_pagamento.provedor,v_pagamento.ambiente,v_pagamento.meio)
      is distinct from (v_empresa,'mercado_pago',p_ambiente,p_meio) then
      raise exception using errcode='23505',message='Pedido incompatível';
    end if;
    if v_pagamento.integracao_mp is null then
      if v_legado then
        return painel_privado.mp_reservar_legado(p_id,p_cliente,p_mesa,p_itens,p_meio,p_ambiente,p_endereco,p_frete);
      end if;
      return jsonb_build_object('bloqueada',true);
    end if;
    select * into v_entrega from public.entregas_pedido where pedido_id=p_id;
    if (p_endereco is null) <> (not found) or
      (p_endereco is not null and (v_entrega.endereco is distinct from public.normalizar_endereco_entrega(p_endereco)
        or v_entrega.frete_centavos is distinct from p_frete)) then
      raise exception using errcode='23505',message='Entrega incompatível';
    end if;
  else
    select id into v_integracao from painel_privado.credenciais_mp
      where empresa_id=v_empresa and ambiente=p_ambiente and estado='ativa';
    if v_integracao is null then
      if exists(select 1 from painel_privado.credenciais_mp where empresa_id=v_empresa and ambiente=p_ambiente and estado='revogada') then
        return jsonb_build_object('bloqueada',true);
      end if;
      if v_legado then
        return painel_privado.mp_reservar_legado(p_id,p_cliente,p_mesa,p_itens,p_meio,p_ambiente,p_endereco,p_frete);
      end if;
      return jsonb_build_object('bloqueada',true);
    end if;
    if not exists(select 1 from public.provedores_pagamento where empresa_id=v_empresa and provedor='mercado_pago'
      and ambiente=p_ambiente and case p_meio when 'pix' then pix_habilitado else credito_habilitado end) then
      raise exception using errcode='22023',message='Meio de pagamento indisponível';
    end if;
    if exists (select 1 from public.pedidos_online where id=p_id) then
      raise exception using errcode='23505',message='Pedido incompatível';
    end if;
    if (select count(*) from public.pagamentos_online pg join public.pedidos_online po on po.id=pg.pedido_id
      where pg.empresa_id=v_empresa and pg.provedor='mercado_pago' and pg.ambiente=p_ambiente
        and po.criado_em >= statement_timestamp()-interval '1 hour') >= 20 then
      raise exception using errcode='22023',message='Limite temporário de pagamentos atingido';
    end if;
    if p_endereco is not null then v_endereco := public.normalizar_endereco_entrega(p_endereco); end if;
    perform public.enviar_pedido(p_slug,p_id,p_cliente,p_mesa,p_itens);
    if p_endereco is not null then
      insert into public.entregas_pedido(pedido_id,endereco,pagamento,frete_centavos)
        values(p_id,v_endereco,'online',p_frete);
      update public.pedidos_online set total_centavos=total_centavos+p_frete where id=p_id and empresa_id=v_empresa;
    end if;
    insert into public.pagamentos_online(pedido_id,empresa_id,provedor,ambiente,meio,valor_centavos,integracao_mp)
      select id,empresa_id,'mercado_pago',p_ambiente,p_meio,total_centavos,v_integracao from public.pedidos_online
      where id=p_id and empresa_id=v_empresa returning * into v_pagamento;
    if not found then raise exception using errcode='P0002',message='Pedido não reservado'; end if;
  end if;
  return painel_privado.mp_envelope_runtime(v_pagamento.integracao_mp) ||
    jsonb_build_object('total_centavos',v_pagamento.valor_centavos,'cobranca',v_pagamento.cobranca_id);
end;
$$;

create function public.servico_mp_vincular_ordem(
  p_integracao uuid,p_pedido uuid,p_ordem text,p_valor bigint,p_meio text,p_confirmado boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  select pg.integracao_mp into p_integracao
  from public.pagamentos_online pg
  join painel_privado.credenciais_mp original on original.id=pg.integracao_mp
  join painel_privado.credenciais_mp origem on origem.id=p_integracao and origem.estado<>'pendente'
    and (origem.empresa_id,origem.ambiente,origem.recebedor)=(original.empresa_id,original.ambiente,original.recebedor)
  where pg.pedido_id=p_pedido;
  if not found then return false; end if;
  perform set_config('painel.integracao_mp',p_integracao::text,true);
  update public.pagamentos_online pg set cobranca_id=p_ordem,
    confirmado_em=case when p_confirmado then coalesce(pg.confirmado_em,now()) else pg.confirmado_em end
  from painel_privado.credenciais_mp c
  where c.id=p_integracao and pg.integracao_mp=c.id and pg.empresa_id=c.empresa_id
    and pg.provedor=c.provedor and pg.ambiente=c.ambiente and pg.pedido_id=p_pedido
    and pg.valor_centavos=p_valor and pg.meio=p_meio and p_ordem ~ '^ORD[A-Z0-9]{1,75}$'
    and (pg.cobranca_id is null or pg.cobranca_id=p_ordem);
  return found;
end;
$$;

revoke all on function painel_privado.mp_envelope_runtime(uuid),public.servico_integracao_mp_webhook(uuid),
  public.servico_mp_reserva_pedido(text,uuid,text,uuid,jsonb,text,text,jsonb,bigint,boolean),
  public.servico_mp_vincular_ordem(uuid,uuid,text,bigint,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.servico_integracao_mp_webhook(uuid),
  public.servico_mp_reserva_pedido(text,uuid,text,uuid,jsonb,text,text,jsonb,bigint,boolean),
  public.servico_mp_vincular_ordem(uuid,uuid,text,bigint,text,boolean) to service_role;

commit;
