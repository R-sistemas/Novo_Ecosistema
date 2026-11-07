begin;

create table public.pix_frente_caixa (
  id uuid primary key,
  caixa_id uuid not null references public.caixas(id),
  venda_id uuid not null,
  pedido_id uuid references public.pedidos_online(id),
  ambiente text not null check (ambiente in ('sandbox','producao')),
  email text,
  itens jsonb not null,
  valor_centavos bigint not null check (valor_centavos>0),
  desconto_centavos bigint not null check (desconto_centavos>=0),
  ordem_id text unique,
  estado text not null default 'reservado' check (estado in ('reservado','aguardando','confirmado','cancelado','expirado','rejeitado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index pix_frente_caixa_ativo on public.pix_frente_caixa(caixa_id) where estado in ('reservado','aguardando');
create unique index pix_frente_pedido_ativo on public.pix_frente_caixa(pedido_id) where estado in ('reservado','aguardando');
create index pix_frente_venda on public.pix_frente_caixa(venda_id);
alter table public.pix_frente_caixa enable row level security;
revoke all on public.pix_frente_caixa from public,anon,authenticated;

create function public.ambiente_pix_frente(p_empresa uuid)
returns text language sql stable set search_path='' as $$
  select pg.ambiente from public.provedores_pagamento pg join public.empresas e on e.id=pg.empresa_id
  where pg.empresa_id=p_empresa and pg.provedor='mercado_pago' and pg.pix_habilitado
    and (pg.ambiente='sandbox' or e.cardapio_slug='quiosque-dorafa')
  order by (pg.ambiente='producao') desc limit 1;
$$;

create function public.pix_frente_disponivel(p_empresa uuid)
returns text language sql stable security definer set search_path='' as $$
  select public.ambiente_pix_frente(p_empresa)
    where exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid());
$$;

create function public.consultar_pix_frente(p_caixa uuid,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caixa public.caixas; tentativa public.pix_frente_caixa;
begin
  caixa:=public.caixa_do_operador(p_caixa);
  select * into tentativa from public.pix_frente_caixa p where p.caixa_id=caixa.id
    and ((p_id is not null and p.id=p_id) or (p_id is null and p.estado in ('reservado','aguardando')));
  if not found then return null; end if;
  return to_jsonb(tentativa);
end;
$$;

create function public.reservar_pix_frente(p_caixa uuid,p_id uuid,p_pedido uuid,p_itens jsonb,
  p_desconto bigint,p_total bigint,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caixa public.caixas; pedido public.pedidos_online; tentativa public.pix_frente_caixa;
  ambiente text; snapshot jsonb; total bigint; venda_id uuid;
begin
  caixa:=public.caixa_do_operador(p_caixa);
  select * into tentativa from public.pix_frente_caixa where id=p_id and caixa_id=p_caixa;
  if found then return to_jsonb(tentativa); end if;
  if caixa.fechado_em is not null then raise exception 'Abra o caixa antes de gerar o Pix.'; end if;
  ambiente:=public.ambiente_pix_frente(caixa.empresa_id);
  if ambiente is null then raise exception 'Pix automático indisponível nesta loja.'; end if;
  if p_id is null or p_desconto is null or p_desconto<0 or p_total is null or p_total<1 then
    raise exception 'Confira o total da venda.';
  end if;
  if ambiente='producao' and (p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Informe o e-mail do pagador.';
  end if;
  if exists(select 1 from public.pix_frente_caixa where caixa_id=p_caixa and estado in ('reservado','aguardando')) then
    raise exception 'Resolva a cobrança Pix já aberta neste caixa.';
  end if;
  if p_pedido is not null then
    select * into pedido from public.pedidos_online where id=p_pedido and empresa_id=caixa.empresa_id for update;
    if not found or pedido.mesa is null or pedido.estado<>'entregue' or public.comanda_protegida(pedido)
      or public.ajuste_comanda_pendente(pedido.id) or p_desconto<>0
      or exists(select 1 from public.adicionais_comanda where pedido_id=p_pedido and estado<>'entregue') then
      raise exception 'Confira se a comanda foi entregue e está disponível para recebimento.';
    end if;
    snapshot:=pedido.itens;
    total:=pedido.total_centavos;
    venda_id:=pedido.id;
  else
    if p_desconto>0 and not public.eh_gestor_kds(caixa.empresa_id) then
      raise exception 'Somente o gestor pode aplicar desconto.' using errcode='42501';
    end if;
    if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Itens inválidos.'; end if;
    if jsonb_array_length(p_itens) not between 1 and 100 then raise exception 'Confira os itens da venda.'; end if;
    select jsonb_agg(jsonb_build_object('produto_id',p.id,'nome',p.nome,'quantidade',i.quantidade,'preco_centavos',p.preco_centavos) order by p.id),
      sum(i.quantidade*p.preco_centavos)-p_desconto into snapshot,total
    from jsonb_to_recordset(p_itens) i(produto_id uuid,quantidade integer)
    join public.produtos p on p.id=i.produto_id and p.empresa_id=caixa.empresa_id and p.ativo and not p.vendido_por_peso
    where i.quantidade between 1 and 1000;
    if snapshot is null or jsonb_array_length(snapshot)<>jsonb_array_length(p_itens)
      or (select count(distinct i->>'produto_id') from jsonb_array_elements(snapshot) i)<>jsonb_array_length(p_itens) then
      raise exception 'Produto ou quantidade indisponível.';
    end if;
    venda_id:=p_id;
  end if;
  if total is distinct from p_total then raise exception 'O total mudou. Confira a venda antes de gerar o Pix.'; end if;
  insert into public.pix_frente_caixa(id,caixa_id,venda_id,pedido_id,ambiente,email,itens,valor_centavos,desconto_centavos)
    values(p_id,p_caixa,venda_id,p_pedido,ambiente,case when ambiente='producao' then lower(btrim(p_email)) end,snapshot,total,p_desconto)
    returning * into tentativa;
  return to_jsonb(tentativa);
end;
$$;

create function public.conciliar_pix_frente(p_id uuid,p_ordem text,p_valor bigint,p_ambiente text,p_estado text)
returns text language plpgsql security definer set search_path='' as $$
declare caixa public.caixas; tentativa public.pix_frente_caixa; pedido public.pedidos_online;
begin
  select c.* into caixa from public.caixas c join public.pix_frente_caixa p on p.caixa_id=c.id where p.id=p_id for update of c;
  if not found then return null; end if;
  select * into tentativa from public.pix_frente_caixa where id=p_id for update;
  if p_valor is distinct from tentativa.valor_centavos or p_ambiente is distinct from tentativa.ambiente
    or (tentativa.ordem_id is not null and tentativa.ordem_id is distinct from p_ordem)
    or p_estado is null or p_estado not in ('aguardando','confirmado','cancelado','expirado','rejeitado')
    or (p_ordem is null and p_estado<>'rejeitado') then raise exception 'Dados da ordem divergentes.'; end if;
  if tentativa.estado not in ('reservado','aguardando') then return tentativa.estado; end if;
  if p_estado='confirmado' then
    if caixa.fechado_em is not null then raise exception 'Caixa fechado para conciliação.'; end if;
    if tentativa.pedido_id is not null then
      select * into pedido from public.pedidos_online where id=tentativa.pedido_id for update;
      if not found or pedido.estado<>'entregue' or pedido.total_centavos<>tentativa.valor_centavos
        or pedido.itens is distinct from tentativa.itens then raise exception 'Comanda divergente.'; end if;
    end if;
  end if;
  update public.pix_frente_caixa set ordem_id=p_ordem,estado=p_estado,atualizado_em=now(),
    email=case when p_estado='aguardando' then email else null end where id=p_id;
  if p_estado='confirmado' then
    insert into public.vendas(id,caixa_id,empresa_id,total_centavos,meio,desconto_centavos)
      values(tentativa.venda_id,caixa.id,caixa.empresa_id,p_valor,'pix',tentativa.desconto_centavos);
    insert into public.itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos,pesagem)
      select tentativa.venda_id,i.produto_id,i.nome,i.quantidade,i.preco_centavos,i.pesagem
      from jsonb_to_recordset(tentativa.itens) i(produto_id uuid,nome text,quantidade integer,preco_centavos bigint,pesagem jsonb);
    insert into public.movimentos_caixa(empresa_id,caixa_id,tipo,valor_centavos,meio)
      values(caixa.empresa_id,caixa.id,'venda',p_valor,'pix');
  end if;
  return p_estado;
end;
$$;

create function public.proteger_caixa_pix_frente()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.pix_frente_caixa where caixa_id=new.id and estado in ('reservado','aguardando')) then
    raise exception 'Conclua ou cancele o Pix em aberto antes de fechar o caixa.';
  end if;
  return new;
end;
$$;
create trigger proteger_caixa_pix_frente before update of fechado_em on public.caixas
for each row when (old.fechado_em is null and new.fechado_em is not null) execute function public.proteger_caixa_pix_frente();

create function public.proteger_venda_pix_frente()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.pix_frente_caixa p where (p.caixa_id=new.caixa_id or p.venda_id=new.id)
    and p.estado in ('reservado','aguardando')) then
    raise exception 'Conclua ou cancele o Pix em aberto antes de registrar a venda.';
  end if;
  if new.meio='pix' and public.ambiente_pix_frente(new.empresa_id) is not null
    and not exists(select 1 from public.pedidos_online where id=new.id and mesa is null)
    and not exists(select 1 from public.pix_frente_caixa p where p.venda_id=new.id and p.caixa_id=new.caixa_id
      and p.estado='confirmado' and p.valor_centavos=new.total_centavos) then
    raise exception 'Use a confirmação automática para receber o Pix no frente de caixa.';
  end if;
  return new;
end;
$$;
create trigger proteger_venda_pix_frente before insert on public.vendas
for each row execute function public.proteger_venda_pix_frente();

create function public.pix_frente_pedido_pendente(p_pedido uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.pix_frente_caixa where pedido_id=p_pedido and estado in ('reservado','aguardando'));
$$;
revoke execute on function public.pix_frente_pedido_pendente(uuid) from public,anon,authenticated;

create or replace function public.comanda_protegida(p public.pedidos_online)
returns boolean language sql stable set search_path='' as $$
  select p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or p.pix_sandbox_confirmado_em is not null
    or exists(select 1 from public.pagamentos_online where pedido_id=p.id)
    or public.pix_frente_pedido_pendente(p.id)
    or exists(select 1 from public.vendas where id=p.id)
    or exists(select 1 from remo.solicitacoes where origem='r_sistemas' and solicitante=p.empresa_id and referencia=p.id::text);
$$;

create or replace function public.adicionar_itens_comanda(p_caixa uuid,p_pedido uuid,p_id uuid,p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.caixas; p public.pedidos_online; a public.adicionais_comanda;
begin
  c := public.caixa_do_operador(p_caixa);
  select * into p from public.pedidos_online where id=p_pedido and empresa_id=c.empresa_id for update;
  if not found then raise exception 'Comanda indisponível.'; end if;
  select * into a from public.adicionais_comanda where id=p_id;
  if found then
    if a.pedido_id<>p_pedido or a.usuario_id<>auth.uid() or a.solicitado<>p_itens then
      raise exception 'Identificador de adicional já utilizado.';
    end if;
    return jsonb_build_object('id',p.id,'total_centavos',p.total_centavos,'itens',p.itens);
  end if;
  if c.fechado_em is not null or p.mesa is null or p.estado<>'entregue'
    or p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null
    or exists(select 1 from public.vendas where id=p.id)
    or public.ajuste_comanda_pendente(p.id) or public.pix_frente_pedido_pendente(p.id)
    or exists(select 1 from public.pagamentos_online where pedido_id=p.id) then
    raise exception 'Adicionais disponíveis apenas em comandas de mesa entregues e sem cobrança online ou recebimento.';
  end if;
  perform public.gravar_adicionais_comanda(p,p_id,p_itens);
  select * into p from public.pedidos_online where id=p_pedido;
  return jsonb_build_object('id',p.id,'total_centavos',p.total_centavos,'itens',p.itens);
end;
$$;

create or replace function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos, p.itens, exists(select 1 from public.adicionais_comanda a where a.pedido_id=p.id and a.estado<>'entregue') as adicionais_pendentes,
      public.ajuste_comanda_pendente(p.id) as ajuste_pendente, public.cancelamento_comanda_pendente(p.id) as cancelamento_pendente,
      public.pix_frente_pedido_pendente(p.id) as pix_presencial_pendente
    from public.pedidos_online p
    where p.empresa_id = p_empresa and p.mesa is not null and p.estado = 'entregue'
      and exists (select 1 from public.membros m where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
      and not exists (select 1 from public.vendas v where v.id = p.id and v.empresa_id = p_empresa)
      and not p.pix_sandbox_solicitado and p.pix_sandbox_cobranca_id is null
      and not exists (select 1 from public.pagamentos_online pg where pg.pedido_id = p.id)
      and (btrim(p_busca) = '' or p.mesa::text = btrim(p_busca) or p.comanda::text = btrim(p_busca))
    order by p.comanda limit 100
  ) c;
$$;

create function public.proteger_checkout_comanda_pix_frente()
returns trigger language plpgsql security definer set search_path='' as $$
declare pedido public.pedidos_online;
begin
  select * into pedido from public.pedidos_online where id=new.pedido_id for update;
  if pedido.mesa is not null and (pedido.estado='recusado' or public.pix_frente_pedido_pendente(pedido.id)
    or exists(select 1 from public.vendas where id=pedido.id)) then
    raise exception 'Comanda indisponível para cobrança online.';
  end if;
  return new;
end;
$$;
revoke execute on function public.proteger_checkout_comanda_pix_frente() from public,anon,authenticated;
create trigger proteger_checkout_comanda_pix_frente before insert on public.pagamentos_online
for each row execute function public.proteger_checkout_comanda_pix_frente();


revoke execute on function public.ambiente_pix_frente(uuid),public.proteger_caixa_pix_frente(),public.proteger_venda_pix_frente(),
  public.conciliar_pix_frente(uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.conciliar_pix_frente(uuid,text,bigint,text,text) to service_role;
revoke execute on function public.pix_frente_disponivel(uuid),public.consultar_pix_frente(uuid,uuid),
  public.reservar_pix_frente(uuid,uuid,uuid,jsonb,bigint,bigint,text) from public,anon;
grant execute on function public.pix_frente_disponivel(uuid),public.consultar_pix_frente(uuid,uuid),
  public.reservar_pix_frente(uuid,uuid,uuid,jsonb,bigint,bigint,text) to authenticated;

commit;
