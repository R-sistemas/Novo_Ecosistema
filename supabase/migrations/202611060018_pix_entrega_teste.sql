begin;

create function public.normalizar_endereco_entrega(p_endereco jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_endereco jsonb;
begin
  if jsonb_typeof(p_endereco) is distinct from 'object' then
    raise exception 'Informe o endereço da entrega.';
  end if;
  v_endereco := jsonb_strip_nulls(jsonb_build_object(
    'logradouro', nullif(btrim(p_endereco->>'logradouro'), ''),
    'numero', nullif(btrim(p_endereco->>'numero'), ''),
    'bairro', nullif(btrim(p_endereco->>'bairro'), ''),
    'cidade', nullif(btrim(p_endereco->>'cidade'), ''),
    'complemento', nullif(btrim(p_endereco->>'complemento'), '')
  ));
  if not (v_endereco ?& array['logradouro','numero','bairro','cidade'])
      or length(v_endereco->>'logradouro') > 150
      or length(v_endereco->>'numero') > 20
      or length(v_endereco->>'bairro') > 100
      or length(v_endereco->>'cidade') > 100
      or length(v_endereco->>'complemento') > 150 then
    raise exception 'Confira o endereço da entrega.';
  end if;

  return v_endereco;
end;
$$;

revoke execute on function public.normalizar_endereco_entrega(jsonb) from public, anon, authenticated;
grant execute on function public.normalizar_endereco_entrega(jsonb) to service_role;

create function public.reservar_pix_entrega_teste(p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_endereco jsonb := public.normalizar_endereco_entrega(p_endereco);
  v_reserva jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('loja-teste:mercado-pago', 3));
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

grant select, insert on public.entregas_pedido to service_role;
revoke execute on function public.reservar_pix_entrega_teste(uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.reservar_pix_entrega_teste(uuid,text,jsonb,jsonb) to service_role;

create or replace function public.enviar_pedido_pagamento_na_entrega(
  p_slug text, p_id uuid, p_cliente text, p_itens jsonb, p_endereco jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_habilitado boolean;
  v_endereco jsonb;
begin
  select id, pagamento_na_entrega into v_empresa, v_habilitado
    from public.empresas where cardapio_slug = p_slug for share;
  if v_empresa is null then raise exception 'Cardápio indisponível.'; end if;
  v_endereco := public.normalizar_endereco_entrega(p_endereco);

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 4));
  if exists (select 1 from public.pedidos_online where id = p_id) then
    if not exists (
      select 1 from public.pedidos_online p join public.entregas_pedido d on d.pedido_id = p.id
      where p.id = p_id and p.empresa_id = v_empresa
        and d.pagamento = 'na_entrega' and d.endereco = v_endereco
    ) then raise exception 'Identificador de pedido já utilizado.'; end if;
    return public.enviar_pedido(p_slug, p_id, p_cliente, null, p_itens);
  end if;
  if not v_habilitado then raise exception 'Este estabelecimento não oferece pagamento na entrega.'; end if;
  perform public.enviar_pedido(p_slug, p_id, p_cliente, null, p_itens);
  insert into public.entregas_pedido (pedido_id, endereco, pagamento)
    values (p_id, v_endereco, 'na_entrega');
  return p_id;
end;
$$;

revoke execute on function public.enviar_pedido_pagamento_na_entrega(text,uuid,text,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.enviar_pedido_pagamento_na_entrega(text,uuid,text,jsonb,jsonb)
  to service_role;

create function public.pagamento_na_entrega_disponivel(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresas where cardapio_slug = p_slug and pagamento_na_entrega);
$$;

revoke execute on function public.pagamento_na_entrega_disponivel(text) from public;
grant execute on function public.pagamento_na_entrega_disponivel(text) to anon, authenticated;

commit;


