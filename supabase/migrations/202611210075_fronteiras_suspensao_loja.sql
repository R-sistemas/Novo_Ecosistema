begin;

create function painel_privado.exigir_operacao_licenciada(p_empresa uuid,p_publica boolean)
returns void language plpgsql set search_path = '' as $$
declare nivel text;
begin
  -- Serializa admissões novas com edição de licença e ação manual da mesma empresa.
  perform 1 from public.empresas where id=p_empresa for share;
  select efetivo into nivel from painel_privado.situacao_empresa(p_empresa);
  if nivel='bloqueada_total' or (p_publica and nivel='bloqueada_parcial') then
    if p_publica then
      raise exception using errcode='P0751',message='Loja fechada para novos pedidos.';
    end if;
    raise exception using errcode='P0751',message='Mensalidade em débito. Novos caixas e vendas estão suspensos.';
  end if;
end;
$$;

create function painel_privado.proteger_pedido_licenca()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Uma tentativa com o mesmo ID ainda passa pelas verificações de idempotência da RPC.
  if not exists(select 1 from public.pedidos_online where id=new.id and empresa_id=new.empresa_id) then
    perform painel_privado.exigir_operacao_licenciada(new.empresa_id,true);
  end if;
  return new;
end;
$$;
create trigger proteger_pedido_licenca before insert on public.pedidos_online
  for each row execute function painel_privado.proteger_pedido_licenca();

create function painel_privado.proteger_caixa_licenca()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform painel_privado.exigir_operacao_licenciada(new.empresa_id,false);
  return new;
end;
$$;
create trigger proteger_caixa_licenca before insert on public.caixas
  for each row execute function painel_privado.proteger_caixa_licenca();

create function painel_privado.proteger_pix_licenca()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform painel_privado.exigir_operacao_licenciada((select empresa_id from public.caixas where id=new.caixa_id),false);
  return new;
end;
$$;
create trigger proteger_pix_licenca before insert on public.pix_frente_caixa
  for each row when (new.pedido_id is null) execute function painel_privado.proteger_pix_licenca();

create function public.licenca_pdv(p_empresa uuid)
returns text language sql stable security definer set search_path = '' as $$
  select st.efetivo from painel_privado.situacao_empresa(p_empresa) st
  where exists(select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid());
$$;

revoke all on function painel_privado.exigir_operacao_licenciada(uuid,boolean),
  painel_privado.proteger_pedido_licenca(),painel_privado.proteger_caixa_licenca(),painel_privado.proteger_pix_licenca(),
  public.licenca_pdv(uuid) from public,anon,authenticated,service_role;
grant execute on function public.licenca_pdv(uuid) to authenticated;

create function painel_privado.registrar_venda_licenciada(p_caixa uuid, p_venda uuid, p_meio text, p_itens jsonb, p_desconto bigint, p_conclusao boolean)
returns bigint language plpgsql set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_total bigint;
  v_itens jsonb;
  v_quantidade integer;
  v_venda public.vendas;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  if p_desconto is null or p_desconto < 0 then raise exception 'Desconto inválido.'; end if;
  if p_desconto > 0 and not exists (
    select 1 from public.membros where empresa_id=v_caixa.empresa_id and usuario_id=auth.uid() and papel='gestor'
  ) then raise exception 'Somente o gestor pode aplicar desconto.' using errcode='42501'; end if;
  if p_venda is null or p_meio is null or p_meio not in ('dinheiro', 'pix', 'cartao') then
    raise exception 'Identificação ou meio de pagamento inválido.';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Itens inválidos.'; end if;
  v_quantidade := jsonb_array_length(p_itens);
  if v_quantidade not between 1 and 100 or exists (
    select 1 from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade integer)
    where i.produto_id is null or i.quantidade is null or i.quantidade not between 1 and 1000
  ) then raise exception 'Itens inválidos.'; end if;

  select * into v_venda from public.vendas where id = p_venda;
  if found then
    if v_venda.caixa_id is distinct from p_caixa or v_venda.meio is distinct from p_meio or v_venda.desconto_centavos is distinct from p_desconto
      or p_itens @> (select jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', quantidade))
        from public.itens_venda where venda_id = p_venda) is not true
      or v_quantidade <> (select count(*) from public.itens_venda where venda_id = p_venda) then
      raise exception 'Identificador já utilizado em outra venda.';
    end if;
    return v_venda.total_centavos;
  end if;
  if not p_conclusao then perform painel_privado.exigir_operacao_licenciada(v_caixa.empresa_id,false); end if;
  if v_caixa.fechado_em is not null then raise exception 'Caixa fechado.'; end if;

  select jsonb_agg(jsonb_build_object('produto_id', p.id, 'nome', p.nome,
      'quantidade', i.quantidade, 'preco_centavos', p.preco_centavos)),
    sum(p.preco_centavos * i.quantidade)
    into v_itens, v_total
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade integer)
    join public.produtos p on p.id = i.produto_id and p.empresa_id = v_caixa.empresa_id and p.ativo and not p.vendido_por_peso;
  if v_itens is null or jsonb_array_length(v_itens) <> v_quantidade then
    raise exception 'Produto indisponível.';
  end if;

  if p_desconto >= v_total then raise exception 'O desconto deve ser menor que o subtotal.'; end if;
  v_total := v_total - p_desconto;
  insert into public.vendas (id, caixa_id, empresa_id, total_centavos, meio, desconto_centavos)
    values (p_venda, p_caixa, v_caixa.empresa_id, v_total, p_meio, p_desconto);
  insert into public.itens_venda (venda_id, produto_id, nome, quantidade, preco_centavos)
    select p_venda, i.produto_id, i.nome, i.quantidade, i.preco_centavos
    from jsonb_to_recordset(v_itens) as i(produto_id uuid, nome text, quantidade integer, preco_centavos bigint);
  insert into public.movimentos_caixa (empresa_id, caixa_id, tipo, valor_centavos, meio)
    values (v_caixa.empresa_id, p_caixa, 'venda', v_total, p_meio);
  return v_total;
end;
$$;

revoke all on function painel_privado.registrar_venda_licenciada(uuid,uuid,text,jsonb,bigint,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.registrar_venda_com_desconto(p_caixa uuid,p_venda uuid,p_meio text,p_itens jsonb,p_desconto bigint)
returns bigint language sql security definer set search_path = '' as $$
  select painel_privado.registrar_venda_licenciada(p_caixa,p_venda,p_meio,p_itens,p_desconto,false);
$$;

create or replace function public.receber_pedido_no_caixa(p_caixa uuid, p_pedido uuid, p_meio text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_pedido public.pedidos_online;
  v_total bigint;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  select * into v_pedido from public.pedidos_online
  where id = p_pedido and empresa_id = v_caixa.empresa_id
  for update;
  if not found or v_pedido.estado = 'recusado' then
    raise exception 'Pedido indisponível.';
  end if;
  if v_pedido.pix_sandbox_solicitado or v_pedido.pix_sandbox_cobranca_id is not null then raise exception 'Pedido vinculado ao Pix Sandbox.'; end if;
  if exists (select 1 from public.pagamentos_online pg where pg.pedido_id=p_pedido) then raise exception 'Pedido com pagamento online.'; end if;
  if v_pedido.mesa is not null then
    if v_pedido.estado <> 'entregue' then raise exception 'A comanda ainda não foi entregue.'; end if;
    if p_meio is null or p_meio not in ('dinheiro','pix','cartao') then raise exception 'Meio de pagamento inválido.'; end if;
    if exists (select 1 from public.vendas where id=p_pedido) then
      select total_centavos into v_total from public.vendas where id=p_pedido
        and caixa_id=p_caixa and empresa_id=v_caixa.empresa_id and meio=p_meio;
      if not found then raise exception 'Comanda já recebida.'; end if;
      return v_total;
    end if;
    if v_caixa.fechado_em is not null then raise exception 'Caixa fechado.'; end if;
    insert into public.vendas(id,caixa_id,empresa_id,total_centavos,meio)
      values(p_pedido,p_caixa,v_caixa.empresa_id,v_pedido.total_centavos,p_meio);
    insert into public.itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos,pesagem)
      select p_pedido,i.produto_id,i.nome,i.quantidade,i.preco_centavos,i.pesagem
      from jsonb_to_recordset(v_pedido.itens) i(produto_id uuid,nome text,quantidade integer,preco_centavos bigint,pesagem jsonb);
    insert into public.movimentos_caixa(empresa_id,caixa_id,tipo,valor_centavos,meio)
      values(v_caixa.empresa_id,p_caixa,'venda',v_pedido.total_centavos,p_meio);
    return v_pedido.total_centavos;
  end if;
  v_total := painel_privado.registrar_venda_licenciada(p_caixa,p_pedido,p_meio,v_pedido.itens,0,true);
  if v_total is distinct from v_pedido.total_centavos or exists (
    select 1 from jsonb_to_recordset(v_pedido.itens)
      as item(produto_id uuid, preco_centavos bigint)
    join public.itens_venda v on v.venda_id = p_pedido and v.produto_id = item.produto_id
    where v.preco_centavos <> item.preco_centavos
  ) then
    raise exception 'O preço do catálogo mudou. Confira o pedido antes de receber.';
  end if;
  return v_total;
end;
$$;

create or replace function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', e.nome, 'cor', e.cardapio_cor, 'fundo', e.cardapio_fundo,
    'logo', e.cardapio_logo, 'agradecimento', e.cardapio_agradecimento,
    'mapa_centro', case when e.mapa_centro_latitude is not null and e.mapa_centro_longitude is not null
      then jsonb_build_object('latitude', e.mapa_centro_latitude, 'longitude', e.mapa_centro_longitude)
      else null end,
    'fechado', st.efetivo in ('bloqueada_parcial','bloqueada_total'),
    'produtos', case when st.efetivo in ('bloqueada_parcial','bloqueada_total') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'preco_centavos',p.preco_centavos,
        'categoria',p.categoria,'descricao',p.descricao,'composicao',p.composicao,
        'foto',md5(p.foto_cardapio),'queridinho',p.queridinho) order by p.nome)
      from public.produtos p where p.empresa_id=e.id and p.ativo and p.visivel_cardapio
    ), '[]'::jsonb) end)
  from public.empresas e cross join lateral painel_privado.situacao_empresa(e.id) st where e.cardapio_slug=p_slug;
$$;

commit;
