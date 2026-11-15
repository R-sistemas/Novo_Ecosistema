begin;

alter table remo.solicitacoes add column ordem_remo uuid unique;

create table remo.tentativas_despacho (
  pedido_id uuid primary key references public.pedidos_online(id) on delete cascade,
  estado text not null check (estado in ('confirmando', 'saldo_insuficiente')),
  atualizado_em timestamptz not null default now()
);
alter table remo.tentativas_despacho enable row level security;
revoke all on remo.tentativas_despacho from public, anon, authenticated;

create function public.preparar_despacho_integrado(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pedido public.pedidos_online;
  v_entrega public.entregas_pedido;
  v_solicitacao remo.solicitacoes;
  v_ambiente text;
begin
  select p.* into v_pedido from public.pedidos_online p
    where p.id = p_pedido and exists (
      select 1 from public.membros m where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid()
    ) for update;
  if not found then raise exception 'Pedido indisponível.' using errcode = '42501'; end if;

  select * into v_solicitacao from remo.solicitacoes
    where origem = 'r_sistemas' and solicitante = v_pedido.empresa_id and referencia = p_pedido::text;
  if found then return jsonb_build_object('ja_solicitado', true); end if;

  if public.ajuste_comanda_pendente(p_pedido) then raise exception 'Resolva o ajuste antes de despachar.'; end if;
  if exists(select 1 from public.adicionais_comanda where pedido_id = p_pedido and estado in ('novo','preparo')) then
    raise exception 'Conclua os adicionais antes de despachar.';
  end if;
  if v_pedido.estado <> 'pronto' then raise exception 'O pedido precisa estar pronto para despacho.'; end if;
  select * into v_entrega from public.entregas_pedido where pedido_id = p_pedido;
  if not found then raise exception 'Pedido sem endereço de entrega.'; end if;
  if v_entrega.pagamento = 'online' and not exists (
    select 1 from public.pagamentos_online where pedido_id = p_pedido and confirmado_em is not null
  ) then raise exception 'Pedido aguarda confirmação do pagamento.'; end if;

  select case when cardapio_slug = 'loja-teste' then 'sandbox' else 'producao' end
    into v_ambiente from public.empresas where id = v_pedido.empresa_id;
  if v_ambiente = 'producao' then
    insert into remo.tentativas_despacho (pedido_id, estado) values (p_pedido, 'confirmando')
      on conflict (pedido_id) do update set estado = excluded.estado, atualizado_em = now();
  end if;
  return jsonb_build_object(
    'empresa', v_pedido.empresa_id,
    'ambiente', v_ambiente,
    'cliente', v_pedido.cliente,
    'endereco', v_entrega.endereco,
    'cobrar_centavos', case when v_entrega.pagamento = 'na_entrega' and not exists (
      select 1 from public.vendas where id = p_pedido and empresa_id = v_pedido.empresa_id
    ) then v_pedido.total_centavos else 0 end
  );
end;
$$;

create function public.registrar_despacho_integrado(p_pedido uuid, p_ordem uuid, p_saldo_insuficiente boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_ordem uuid;
begin
  select empresa_id into strict v_empresa from public.pedidos_online where id = p_pedido for update;
  if p_ordem is null then
    if p_saldo_insuficiente then
      update remo.tentativas_despacho set estado = 'saldo_insuficiente', atualizado_em = now()
        where pedido_id = p_pedido;
    else
      delete from remo.tentativas_despacho where pedido_id = p_pedido and estado = 'confirmando';
    end if;
    return;
  end if;
  insert into remo.solicitacoes (origem, ambiente, referencia, solicitante, destino, cobrar_na_entrega_centavos, ordem_remo)
    select 'r_sistemas', 'producao', p.id::text, p.empresa_id, e.endereco, case when e.pagamento = 'na_entrega'
      and not exists (select 1 from public.vendas v where v.id = p.id and v.empresa_id = p.empresa_id)
      then p.total_centavos else 0 end, p_ordem
    from public.pedidos_online p join public.entregas_pedido e on e.pedido_id = p.id where p.id = p_pedido
    on conflict (origem, solicitante, referencia) do update set ordem_remo = excluded.ordem_remo
    where remo.solicitacoes.ordem_remo is null or remo.solicitacoes.ordem_remo = excluded.ordem_remo
    returning ordem_remo into v_ordem;
  if v_ordem is null then raise exception 'Despacho REMO não pôde ser vinculado.'; end if;
  delete from remo.tentativas_despacho where pedido_id = p_pedido;
end;
$$;

create function public.atualizar_despacho_integrado(p_pedido uuid, p_ordem uuid, p_estado text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_estado not in ('aceita', 'em_rota', 'entregue') then return false; end if;
  if exists (select 1 from remo.tentativas_despacho where pedido_id = p_pedido and estado = 'confirmando') then
    perform public.registrar_despacho_integrado(p_pedido, p_ordem);
  end if;
  update remo.solicitacoes
    set estado = p_estado
    where ordem_remo = p_ordem and referencia = p_pedido::text and origem = 'r_sistemas'
      and ((estado = 'solicitada') or (estado = 'aceita' and p_estado in ('em_rota', 'entregue'))
        or (estado = 'em_rota' and p_estado = 'entregue'));
  return exists (select 1 from remo.solicitacoes where ordem_remo = p_ordem and referencia = p_pedido::text);
end;
$$;

create function public.alertas_saldo_remo(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.membros where usuario_id = auth.uid() and empresa_id = p_empresa and papel = 'gestor'
  ) then
    raise exception 'Acesso ao monitor indisponível para esta loja.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(a order by a.atualizado_em desc) from (
    select p.comanda, s.atualizado_em
    from remo.tentativas_despacho s join public.pedidos_online p on p.id = s.pedido_id
    where p.empresa_id = p_empresa and p.estado = 'pronto' and s.estado = 'saldo_insuficiente'
    order by s.atualizado_em desc limit 25
  ) a), '[]'::jsonb);
end;
$$;

create or replace function public.fila_remo()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from remo.operadores where usuario_id = auth.uid()) then
    raise exception 'Acesso à central REMO indisponível.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.criada_em) from (
    select id, origem, ambiente, destino, cobrar_na_entrega_centavos, estado, criada_em
    from remo.solicitacoes where ordem_remo is null and estado in ('solicitada','aceita','em_rota')
    order by criada_em limit 100
  ) s), '[]'::jsonb);
end;
$$;

revoke execute on function public.preparar_despacho_integrado(uuid), public.alertas_saldo_remo(uuid),
  public.registrar_despacho_integrado(uuid, uuid, boolean), public.atualizar_despacho_integrado(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.preparar_despacho_integrado(uuid), public.alertas_saldo_remo(uuid) to authenticated;
grant execute on function public.registrar_despacho_integrado(uuid, uuid, boolean),
  public.atualizar_despacho_integrado(uuid, uuid, text) to service_role;

create or replace function public.solicitar_despacho_remo(p_pedido uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pedido public.pedidos_online;
  v_entrega public.entregas_pedido;
  v_solicitacao uuid;
begin
  select p.* into v_pedido from public.pedidos_online p
    where p.id = p_pedido and exists (
      select 1 from public.membros m where m.empresa_id = p.empresa_id and m.usuario_id = auth.uid()
    ) for update;
  if not found then raise exception 'Pedido indisponível.'; end if;

  select id into v_solicitacao from remo.solicitacoes
    where origem = 'r_sistemas' and solicitante = v_pedido.empresa_id and referencia = p_pedido::text;
  if found then return v_solicitacao; end if;
  if not exists (select 1 from public.empresas where id = v_pedido.empresa_id and cardapio_slug = 'loja-teste') then
    raise exception 'Atualize o PDV para solicitar o despacho pela REMO.';
  end if;
  if public.ajuste_comanda_pendente(p_pedido) then raise exception 'Resolva o ajuste antes de despachar.'; end if;
  if exists(select 1 from public.adicionais_comanda where pedido_id=p_pedido and estado in ('novo','preparo')) then
    raise exception 'Conclua os adicionais antes de despachar.';
  end if;
  if v_pedido.estado <> 'pronto' then raise exception 'O pedido precisa estar pronto para despacho.'; end if;
  select * into v_entrega from public.entregas_pedido where pedido_id = p_pedido;
  if not found then raise exception 'Pedido sem endereço de entrega.'; end if;
  if v_entrega.pagamento = 'online' and not exists (
    select 1 from public.pagamentos_online where pedido_id = p_pedido and confirmado_em is not null
  ) then raise exception 'Pedido aguarda confirmação do pagamento.'; end if;

  insert into remo.solicitacoes (origem, ambiente, referencia, solicitante, destino, cobrar_na_entrega_centavos)
    values ('r_sistemas', case when exists (select 1 from public.empresas
      where id = v_pedido.empresa_id and cardapio_slug = 'loja-teste') then 'sandbox' else 'producao' end,
      p_pedido::text, v_pedido.empresa_id, v_entrega.endereco,
      case when v_entrega.pagamento = 'na_entrega' and not exists (
        select 1 from public.vendas where id = p_pedido and empresa_id = v_pedido.empresa_id
      ) then v_pedido.total_centavos else 0 end)
    returning id into v_solicitacao;
  return v_solicitacao;
end;
$$;

create or replace function public.avancar_solicitacao_remo(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from remo.operadores where usuario_id = auth.uid()) then
    raise exception 'Acesso à central REMO indisponível.';
  end if;
  update remo.solicitacoes set estado = p_estado
    where id = p_id and ordem_remo is null and (
      (estado = 'solicitada' and p_estado in ('aceita','cancelada'))
      or (estado = 'aceita' and p_estado in ('em_rota','cancelada'))
      or (estado = 'em_rota' and p_estado = 'entregue')
    );
  if not found then raise exception 'Solicitação indisponível ou transição inválida.'; end if;
end;
$$;

create or replace function public.comanda_protegida(p public.pedidos_online)
returns boolean language sql stable set search_path = '' as $$
  select p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or p.pix_sandbox_confirmado_em is not null
    or exists (select 1 from public.pagamentos_online where pedido_id = p.id)
    or public.pix_frente_pedido_pendente(p.id)
    or exists (select 1 from public.vendas where id = p.id)
    or exists (select 1 from remo.solicitacoes where origem = 'r_sistemas' and solicitante = p.empresa_id and referencia = p.id::text)
    or exists (select 1 from remo.tentativas_despacho where pedido_id = p.id and estado = 'confirmando');
$$;

commit;
