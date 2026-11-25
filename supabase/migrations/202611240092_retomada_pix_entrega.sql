begin;

create or replace function public.servico_mp_reserva_pedido(
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
  v_entrega_habilitada boolean;
  v_retomar_pix boolean := p_meio='pix' and p_endereco is null and p_mesa is null
    and p_cliente is null and p_itens='[]'::jsonb;
begin
  if p_meio not in ('pix','credito') or p_ambiente not in ('producao','sandbox')
    or (p_endereco is not null and (p_mesa is not null or p_frete is null or p_frete < 0)) then
    raise exception using errcode='22023',message='Pedido inválido';
  end if;
  select id, oferece_entrega or sandbox_checkout into v_empresa,v_entrega_habilitada
  from public.empresas where cardapio_slug=p_slug for update;
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
    if (not coalesce(v_retomar_pix,false) and (p_endereco is null) <> (not found)) or
      (p_endereco is not null and (v_entrega.endereco is distinct from public.normalizar_endereco_entrega(p_endereco)
        or v_entrega.frete_centavos is distinct from p_frete)) then
      raise exception using errcode='23505',message='Entrega incompatível';
    end if;
  else
    if p_endereco is not null and not v_entrega_habilitada then
      raise exception using errcode='22023',message='Esta loja não oferece entrega';
    end if;
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

commit;