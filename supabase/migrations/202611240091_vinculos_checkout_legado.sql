begin;

create table painel_privado.asaas_legado_empresa (
  ambiente text primary key check (ambiente in ('producao','sandbox')),
  empresa_id uuid not null references public.empresas(id) on delete cascade
);
revoke all on painel_privado.asaas_legado_empresa from public,anon,authenticated,service_role;

-- Mantém os destinatários originais das duas credenciais de deploy.
insert into painel_privado.asaas_legado_empresa(ambiente,empresa_id)
select v.ambiente,e.id
from (values ('producao','quiosque-dorafa'),('sandbox','loja-teste')) v(ambiente,slug)
join public.empresas e on e.cardapio_slug=v.slug;

create function public.servico_slug_checkout_legado(p_provedor text,p_ambiente text)
returns text language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then min(e.cardapio_slug) end
  from public.empresas e
  join (
    select empresa_id from painel_privado.asaas_legado_empresa
    where p_provedor='asaas' and ambiente=p_ambiente
    union all
    select empresa_id from painel_privado.mp_legado_empresa
    where p_provedor='mercado_pago' and ambiente=p_ambiente
  ) l on l.empresa_id=e.id;
$$;
revoke all on function public.servico_slug_checkout_legado(text,text) from public,anon,authenticated,service_role;
grant execute on function public.servico_slug_checkout_legado(text,text) to service_role;

create function public.servico_asaas_checkout_legado(p_slug text,p_ambiente text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(p_slug=public.servico_slug_checkout_legado('asaas',p_ambiente),false);
$$;
revoke all on function public.servico_asaas_checkout_legado(text,text) from public,anon,authenticated,service_role;
grant execute on function public.servico_asaas_checkout_legado(text,text) to service_role;

create or replace function public.atualizar_credito_mercado_pago_quiosque(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','producao')
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and pg.meio = 'credito' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;

create or replace function public.atualizar_credito_mercado_pago_teste(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','sandbox')
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
      and pg.meio = 'credito' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;

create or replace function public.atualizar_pix_mercado_pago_quiosque(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','producao')
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and pg.meio = 'pix' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;

create or replace function public.atualizar_pix_mercado_pago_teste(p_pedido uuid, p_cobranca text, p_valor bigint, p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online pg
    set cobranca_id = p_cobranca,
        confirmado_em = case when p_confirmado then coalesce(pg.confirmado_em, now()) else pg.confirmado_em end
    from public.empresas e
    where e.id = pg.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','sandbox')
      and pg.pedido_id = p_pedido and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
      and pg.meio = 'pix' and pg.valor_centavos = p_valor
      and (pg.cobranca_id is null or pg.cobranca_id = p_cobranca);
  return found;
end;
$$;

create or replace function public.atualizar_pix_quiosque(p_pedido uuid,p_cobranca text,p_valor bigint,p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.pagamentos_online p
    set cobranca_id=p_cobranca,
        confirmado_em=case when p_confirmado then coalesce(p.confirmado_em,now()) else p.confirmado_em end
  from public.empresas e
  where e.id=p.empresa_id and e.cardapio_slug=public.servico_slug_checkout_legado('asaas','producao')
    and p.pedido_id=p_pedido and p.provedor='asaas' and p.meio='pix'
    and p.valor_centavos=p_valor and (p.cobranca_id is null or p.cobranca_id=p_cobranca);
  return found;
end;
$$;

create or replace function public.iniciar_checkout_pix_sandbox(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pedido public.pedidos_online;
  v_criar boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 1));
  select * into v_pedido from public.pedidos_online where id = p_id;
  v_criar := not found;
  if v_criar then
    perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('asaas','sandbox') || ':checkout-pix'), 1));
    if (select count(*) from public.pedidos_online where pix_sandbox_solicitado
        and criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite de testes Pix atingido. Tente novamente mais tarde.';
    end if;
    perform public.enviar_pedido(public.servico_slug_checkout_legado('asaas','sandbox'),p_id,p_cliente,p_mesa,p_itens);
    update public.pedidos_online set pix_sandbox_solicitado = true
      where id = p_id returning * into v_pedido;
  elsif not v_pedido.pix_sandbox_solicitado or not exists (
    select 1 from public.empresas e where e.id = v_pedido.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('asaas','sandbox')
  ) then
    raise exception 'Identificador indisponível para Pix Sandbox.';
  end if;
  return jsonb_build_object('criar',v_criar,'total_centavos',v_pedido.total_centavos,
    'cobranca',v_pedido.pix_sandbox_cobranca_id);
end;
$$;

create or replace function public.recusar_credito_mercado_pago_quiosque(p_pedido uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos_online p set estado = 'recusado'
    from public.pagamentos_online pg, public.empresas e
    where p.id = p_pedido and p.estado = 'novo' and pg.pedido_id = p.id
      and e.id = p.empresa_id and e.id = pg.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','producao')
      and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao' and pg.meio = 'credito'
      and pg.cobranca_id is null and pg.confirmado_em is null;
  return found;
end;
$$;

create or replace function public.recusar_credito_mercado_pago_teste(p_pedido uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos_online p set estado = 'recusado'
    from public.pagamentos_online pg, public.empresas e
    where p.id = p_pedido and p.estado = 'novo' and pg.pedido_id = p.id
      and e.id = p.empresa_id and e.id = pg.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','sandbox')
      and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox' and pg.meio = 'credito'
      and pg.cobranca_id is null and pg.confirmado_em is null;
  return found;
end;
$$;

create or replace function public.reservar_credito_entrega_frete_quiosque(
  p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_pagamento public.pagamentos_online;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_credito_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  perform public.reservar_credito_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id
    and provedor = 'mercado_pago' and ambiente = 'producao' and meio = 'credito';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create or replace function public.reservar_credito_mercado_pago_quiosque(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and pg.meio = 'credito' and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','producao');
  if not found then
    if not exists (select 1 from public.provedores_pagamento c join public.empresas e on e.id = c.empresa_id
      where e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','producao') and c.provedor = 'mercado_pago'
        and c.ambiente = 'producao' and c.credito_habilitado) then
      raise exception 'Crédito online indisponível.';
    end if;
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite temporário de pagamentos atingido.';
    end if;
    perform public.enviar_pedido(public.servico_slug_checkout_legado('mercado_pago','producao'), p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'producao', 'credito', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create or replace function public.reservar_credito_mercado_pago_teste(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','sandbox') || ':mercado-pago'), 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
      and pg.meio = 'credito' and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','sandbox');
  if not found then
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite de testes de pagamento atingido.';
    end if;
    perform public.enviar_pedido(public.servico_slug_checkout_legado('mercado_pago','sandbox'), p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'sandbox', 'credito', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create or replace function public.reservar_pix_entrega_frete_quiosque(
  p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
  v_pagamento public.pagamentos_online;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id and provedor = 'mercado_pago' and ambiente = 'producao';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos, 'cobranca', v_pagamento.cobranca_id);
end;
$$;

create or replace function public.reservar_pix_entrega_frete_teste(
  p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','sandbox') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos
    where pedido_id = p_id and ambiente = 'sandbox';
  return jsonb_set(v_reserva, '{total_centavos}', to_jsonb((v_reserva->>'total_centavos')::bigint + p_frete_centavos));
end;
$$;

create or replace function public.reservar_pix_entrega_quiosque(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_reserva jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  if exists (select 1 from public.pedidos_online where id = p_id)
     and not exists (select 1 from public.entregas_pedido where pedido_id = p_id
        and pagamento = 'online' and endereco = v_endereco) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento)
    values (p_id, v_endereco, 'online') on conflict (pedido_id) do nothing;
  return v_reserva;
end;
$$;

create or replace function public.reservar_pix_entrega_teste(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_reserva jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','sandbox') || ':mercado-pago'), 3));
  if exists (select 1 from public.pedidos_online where id = p_id)
     and not exists (select 1 from public.entregas_pedido where pedido_id = p_id
        and pagamento = 'online' and endereco = v_endereco) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  v_reserva := public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento)
    values (p_id, v_endereco, 'online') on conflict (pedido_id) do nothing;
  return v_reserva;
end;
$$;

create or replace function public.reservar_pix_mercado_pago_quiosque(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
      and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','producao');
  if not found then
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'producao'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite temporário de pedidos Pix atingido.';
    end if;
    perform public.enviar_pedido(public.servico_slug_checkout_legado('mercado_pago','producao'), p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'producao', 'pix', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create or replace function public.reservar_pix_mercado_pago_teste(p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_pagamento public.pagamentos_online;
begin
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','sandbox') || ':mercado-pago'), 3));
  select pg.* into v_pagamento from public.pagamentos_online pg
    join public.empresas e on e.id = pg.empresa_id
    where pg.pedido_id = p_id and pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
      and e.cardapio_slug = public.servico_slug_checkout_legado('mercado_pago','sandbox');
  if not found then
    if (select count(*) from public.pagamentos_online pg
        join public.pedidos_online p on p.id = pg.pedido_id
        where pg.provedor = 'mercado_pago' and pg.ambiente = 'sandbox'
          and p.criado_em >= now() - interval '1 hour') >= 20 then
      raise exception 'Limite de testes Pix atingido.';
    end if;
    perform public.enviar_pedido(public.servico_slug_checkout_legado('mercado_pago','sandbox'), p_id, p_cliente, p_mesa, p_itens);
    insert into public.pagamentos_online (pedido_id, empresa_id, provedor, ambiente, meio, valor_centavos)
      select id, empresa_id, 'mercado_pago', 'sandbox', 'pix', total_centavos
      from public.pedidos_online where id = p_id returning * into v_pagamento;
  end if;
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$$;

create or replace function public.reservar_pix_quiosque(p_id uuid,p_cliente text,p_mesa uuid,p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_empresa uuid;
  v_pagamento public.pagamentos_online;
  v_criar boolean;
begin
  select e.id into strict v_empresa from public.empresas e
    join public.provedores_pagamento c on c.empresa_id=e.id
    where e.cardapio_slug=public.servico_slug_checkout_legado('asaas','producao') and c.provedor='asaas'
      and c.ambiente='producao' and c.pix_habilitado;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 2));
  select * into v_pagamento from public.pagamentos_online
    where pedido_id=p_id and empresa_id=v_empresa and provedor='asaas' and meio='pix';
  v_criar := not found;
  if v_criar then
    if exists(select 1 from public.pedidos_online where id=p_id) then
      raise exception 'Pedido já registrado.';
    end if;
    perform public.enviar_pedido(public.servico_slug_checkout_legado('asaas','producao'),p_id,p_cliente,p_mesa,p_itens);
    insert into public.pagamentos_online(pedido_id,empresa_id,provedor,meio,valor_centavos)
      select id,empresa_id,'asaas','pix',total_centavos from public.pedidos_online where id=p_id
      returning * into v_pagamento;
  end if;
  return jsonb_build_object('criar',v_criar,'total_centavos',v_pagamento.valor_centavos,
    'cobranca',v_pagamento.cobranca_id,'confirmado',v_pagamento.confirmado_em is not null);
end;
$$;

create or replace function public.vincular_pix_sandbox(p_pedido uuid, p_cobranca text, p_valor bigint)
returns void language plpgsql set search_path = '' as $$
begin
  if p_cobranca is null or p_cobranca !~ '^pay_[A-Za-z0-9]+$' then
    raise exception 'Cobrança inválida.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cobranca, 0));
  update public.pedidos_online p set pix_sandbox_cobranca_id = p_cobranca
  where p.id = p_pedido and p.estado = 'novo' and p.total_centavos = p_valor and exists (select 1 from public.empresas e where e.id = p.empresa_id and e.cardapio_slug = public.servico_slug_checkout_legado('asaas','sandbox'))
    and (p.pix_sandbox_cobranca_id is null or p.pix_sandbox_cobranca_id = p_cobranca)
    and not exists (select 1 from public.vendas v where v.id = p.id);
  if not found then raise exception 'Pedido indisponível para vincular a cobrança.'; end if;
  perform public.confirmar_pix_sandbox(p_cobranca);
end;
$$;

CREATE OR REPLACE FUNCTION public.reservar_credito_entrega_frete_quiosque(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_pagamento public.pagamentos_online;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id ;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_credito_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  perform public.reservar_credito_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id
    and provedor = 'mercado_pago' and ambiente = 'producao' and meio = 'credito';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos,
    'cobranca', v_pagamento.cobranca_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_pix_entrega_frete_quiosque(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
  v_pagamento public.pagamentos_online;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id ;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id and provedor = 'mercado_pago' and ambiente = 'producao';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos, 'cobranca', v_pagamento.cobranca_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_pix_entrega_frete_teste(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','sandbox') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id ;
  if found then
    if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
       or v_existente.frete_centavos <> p_frete_centavos then
      raise exception 'Identificador de pedido já utilizado com outros dados.';
    end if;
    return public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
    values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos
    where pedido_id = p_id and ambiente = 'sandbox';
  return jsonb_set(v_reserva, '{total_centavos}', to_jsonb((v_reserva->>'total_centavos')::bigint + p_frete_centavos));
end;
$function$;

CREATE OR REPLACE FUNCTION public.reservar_pix_entrega_quiosque(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
      declare
        v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
          v_existente public.entregas_pedido;
  v_reserva jsonb;
  v_pagamento public.pagamentos_online;
  begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','producao') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
  if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
  or v_existente.frete_centavos <> p_frete_centavos then
  raise exception 'Identificador de pedido já utilizado com outros dados.';
  end if;
  return public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
  raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_quiosque(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
  values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos where pedido_id = p_id;
  select * into v_pagamento from public.pagamentos_online where pedido_id = p_id and provedor = 'mercado_pago' and ambiente = 'producao';
  return jsonb_build_object('total_centavos', v_pagamento.valor_centavos, 'cobranca', v_pagamento.cobranca_id);
  end;
  $function$;

CREATE OR REPLACE FUNCTION public.reservar_pix_entrega_teste(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb, p_frete_centavos bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
  declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_existente public.entregas_pedido;
  v_reserva jsonb;
  begin
  if p_frete_centavos is null or p_frete_centavos < 0 then raise exception 'Cotação de entrega inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended((public.servico_slug_checkout_legado('mercado_pago','sandbox') || ':mercado-pago'), 3));
  select * into v_existente from public.entregas_pedido where pedido_id = p_id for update;
  if found then
  if v_existente.pagamento <> 'online' or v_existente.endereco <> v_endereco
  or v_existente.frete_centavos <> p_frete_centavos then
  raise exception 'Identificador de pedido já utilizado com outros dados.';
  end if;
  return public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  end if;
  if exists (select 1 from public.pedidos_online where id = p_id) then
  raise exception 'Identificador de pedido já utilizado.';
  end if;

  v_reserva := public.reservar_pix_mercado_pago_teste(p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento, frete_centavos)
  values (p_id, v_endereco, 'online', p_frete_centavos);
  update public.pedidos_online set total_centavos = total_centavos + p_frete_centavos where id = p_id;
  update public.pagamentos_online set valor_centavos = valor_centavos + p_frete_centavos
  where pedido_id = p_id and ambiente = 'sandbox';
  return jsonb_set(v_reserva, '{total_centavos}', to_jsonb((v_reserva->>'total_centavos')::bigint + p_frete_centavos));
  end;
  $function$;

commit;
