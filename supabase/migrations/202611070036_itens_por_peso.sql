begin;

alter table public.produtos add column vendido_por_peso boolean not null default false;
alter table public.produtos add check (not vendido_por_peso or (not visivel_cardapio and not preparo_cozinha));
alter table public.itens_venda add column id uuid not null default gen_random_uuid();
alter table public.itens_venda add column pesagem jsonb;
alter table public.itens_venda drop constraint itens_venda_pkey;
alter table public.itens_venda add primary key (id);
create unique index itens_venda_produto_unidade on public.itens_venda(venda_id,produto_id) where pesagem is null;
create unique index itens_venda_pesagem on public.itens_venda(venda_id,(pesagem->>'id')) where pesagem is not null;
alter table public.ajustes_comanda add column pedido_pesagem jsonb;

-- A weighing is one priced line. Repeated weighings of the same product retain their individual price and weight.
create function public.ajustar_item_pesado(p_empresa uuid,p_pedido uuid,p_id uuid,p_produto uuid,
  p_gramas integer,p_valor bigint,p_retirar uuid,p_caixa uuid,p_motivo text)
returns void language plpgsql security definer set search_path='' as $$
declare
  caixa public.caixas; pedido public.pedidos_online; produto public.produtos; ajuste public.ajustes_comanda;
  linha jsonb; itens_novos jsonb; pesagem jsonb; valor bigint; total bigint;
  requisicao jsonb:=jsonb_build_object('produto',p_produto,'gramas',p_gramas,'valor',p_valor,'retirar',p_retirar);
begin
  if p_caixa is not null then
    caixa:=public.caixa_do_operador(p_caixa);
    if caixa.empresa_id<>p_empresa or caixa.fechado_em is not null then
      raise exception 'Abra o caixa desta loja antes de ajustar a comanda.';
    end if;
  elsif not public.pode_editar_comanda_kds(p_empresa) then
    raise exception 'Permissão de edição da cozinha necessária.' using errcode='42501';
  end if;
  select * into pedido from public.pedidos_online where id=p_pedido and empresa_id=p_empresa for update;
  if not found then raise exception 'Comanda indisponível.'; end if;
  select * into ajuste from public.ajustes_comanda where id=p_id;
  if found then
    if ajuste.pedido_id<>p_pedido or ajuste.autor<>auth.uid() or ajuste.pedido_pesagem is distinct from requisicao
      or ajuste.motivo is distinct from btrim(p_motivo) then raise exception 'Identificador de ajuste já usado.'; end if;
    return;
  end if;
  if pedido.mesa is null or pedido.estado='recusado' or public.comanda_protegida(pedido)
    or public.ajuste_comanda_pendente(pedido.id) then
    raise exception 'Lançamento por peso disponível em comandas de mesa abertas e sem cobrança.';
  end if;
  if p_id is null or p_motivo is null or length(btrim(p_motivo)) not between 3 and 240 then
    raise exception 'Informe o motivo do ajuste.';
  end if;
  if p_retirar is not null then
    if p_produto is not null or p_gramas is not null or p_valor is not null then raise exception 'Retirada inválida.'; end if;
    select i into linha from jsonb_array_elements(pedido.itens) i where i->'pesagem'->>'id'=p_retirar::text;
    if not found then raise exception 'Lançamento indisponível nesta comanda.'; end if;
    select coalesce(jsonb_agg(i order by pos),'[]'::jsonb) into itens_novos
      from jsonb_array_elements(pedido.itens) with ordinality x(i,pos)
      where (i->'pesagem'->>'id') is distinct from p_retirar::text;
    total:=pedido.total_centavos-(linha->>'preco_centavos')::bigint;
  else
    if (p_gramas is null)=(p_valor is null) or (p_gramas is not null and p_gramas not between 1 and 100000)
      or (p_valor is not null and p_valor not between 1 and 1000000) then
      raise exception 'Informe o peso em gramas ou o valor em reais.';
    end if;
    select * into produto from public.produtos where id=p_produto and empresa_id=p_empresa and ativo and vendido_por_peso;
    if not found then raise exception 'Produto por peso indisponível.'; end if;
    valor:=coalesce(p_valor,round(produto.preco_centavos::numeric*p_gramas/1000)::bigint);
    if valor not between 1 and 1000000 then raise exception 'O valor do lançamento deve ficar entre R$ 0,01 e R$ 10.000,00.'; end if;
    pesagem:=jsonb_build_object('id',p_id,'modo',case when p_gramas is null then 'valor' else 'peso' end,
      'gramas',p_gramas,'preco_quilo_centavos',case when p_gramas is not null then produto.preco_centavos end);
    linha:=jsonb_build_object('produto_id',produto.id,'nome',produto.nome,'quantidade',1,'preco_centavos',valor,'pesagem',pesagem);
    itens_novos:=pedido.itens || jsonb_build_array(linha);
    total:=pedido.total_centavos+valor;
  end if;
  update public.pedidos_online set itens=itens_novos, total_centavos=total,
    itens_preparo_original=public.itens_originais_comanda(pedido),
    estado=case when total=0 then 'recusado' else pedido.estado end where id=pedido.id;
  insert into public.ajustes_comanda(id,pedido_id,autor,operacao,produto_id,produto_nome,quantidade,motivo,estado,
    resolvido_por,resolvido_em,antes,depois,pedido_pesagem)
  values(p_id,pedido.id,auth.uid(),case when p_retirar is null then 'adicionar' else 'retirar' end,
    (linha->>'produto_id')::uuid,linha->>'nome',1,btrim(p_motivo),'aplicado',auth.uid(),now(),pedido.itens,itens_novos,requisicao);
end;
$$;
revoke execute on function public.ajustar_item_pesado(uuid,uuid,uuid,uuid,integer,bigint,uuid,uuid,text) from public,anon;
grant execute on function public.ajustar_item_pesado(uuid,uuid,uuid,uuid,integer,bigint,uuid,uuid,text) to authenticated;

create or replace function public.registrar_venda_com_desconto(p_caixa uuid, p_venda uuid, p_meio text, p_itens jsonb, p_desconto bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
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
  v_total := public.registrar_venda(p_caixa, p_pedido, p_meio, v_pedido.itens);
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

create or replace function public.gravar_adicionais_comanda(p public.pedidos_online,p_id uuid,p_itens jsonb)
returns void language plpgsql set search_path='' as $$
declare novos jsonb; preparo jsonb; reunidos jsonb; valor bigint;
  originais jsonb:=public.itens_originais_comanda(p);
begin
  if p_id is null or jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Adicionais inválidos.'; end if;
  if jsonb_array_length(p_itens) not between 1 and 30 or exists (
    select 1 from jsonb_to_recordset(p_itens) i(produto_id uuid,quantidade integer)
    where i.produto_id is null or i.quantidade is null or i.quantidade not between 1 and 100
  ) or (select count(distinct i->>'produto_id') from jsonb_array_elements(p_itens) i)<>jsonb_array_length(p_itens)
  then raise exception 'Confira produtos e quantidades dos adicionais.'; end if;
  -- Existing lines retain the agreed price even if the catalog has since changed.
  select jsonb_agg(jsonb_build_object('produto_id',pr.id,'nome',coalesce(old->>'nome',pr.nome),
    'quantidade',i.quantidade,'preco_centavos',coalesce((old->>'preco_centavos')::bigint,pr.preco_centavos))),
    coalesce(jsonb_agg(jsonb_build_object('produto_id',pr.id,'nome',coalesce(old->>'nome',pr.nome),
      'quantidade',i.quantidade)) filter(where pr.preparo_cozinha),'[]'::jsonb)
  into novos,preparo from jsonb_to_recordset(p_itens) i(produto_id uuid,quantidade integer)
  join public.produtos pr on pr.id=i.produto_id and pr.empresa_id=p.empresa_id and pr.ativo and not pr.vendido_por_peso
  left join lateral (select x as old from jsonb_array_elements(p.itens) x where x->>'produto_id'=pr.id::text and not (x ? 'pesagem') limit 1) o on true;
  if novos is null or jsonb_array_length(novos)<>jsonb_array_length(p_itens) then raise exception 'Produto indisponível.'; end if;
  select jsonb_agg(jsonb_build_object('produto_id',produto_id,'nome',nome,'preco_centavos',preco_centavos,'quantidade',quantidade) order by produto_id),
    sum(preco_centavos*quantidade) into reunidos,valor from (
    select produto_id,nome,preco_centavos,sum(quantidade)::integer quantidade
    from jsonb_to_recordset(p.itens || novos) i(produto_id uuid,nome text,preco_centavos bigint,quantidade integer,pesagem jsonb)
    where pesagem is null
    group by produto_id,nome,preco_centavos
  ) s;
  if exists(select 1 from jsonb_array_elements(reunidos) x where (x->>'quantidade')::integer>1000)
    then raise exception 'Quantidade acumulada acima do limite.'; end if;
  -- Preserve distinct weighings and their charged amounts when adding fixed-price products.
  select reunidos || coalesce(jsonb_agg(i order by pos),'[]'::jsonb), valor+coalesce(sum((i->>'preco_centavos')::bigint),0)
    into reunidos,valor from jsonb_array_elements(p.itens) with ordinality x(i,pos) where i ? 'pesagem';
  insert into public.adicionais_comanda(id,pedido_id,usuario_id,solicitado,itens,estado)
    values(p_id,p.id,auth.uid(),p_itens,preparo,case when jsonb_array_length(preparo)>0 then 'novo' else 'entregue' end);
  update public.pedidos_online set itens=reunidos,total_centavos=valor,
    itens_preparo_original=originais where id=p.id;
end;
$$;

create or replace function public.quantidade_item(p_itens jsonb,p_produto uuid)
returns integer language sql immutable set search_path='' as $$
  select coalesce(sum(i.quantidade),0)::integer from jsonb_to_recordset(p_itens) i(produto_id uuid,quantidade integer,pesagem jsonb)
  where i.produto_id=p_produto and i.pesagem is null;
$$;

create or replace function public.reduzir_item_comanda(p_itens jsonb,p_produto uuid,p_quantidade integer)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(item || jsonb_build_object('quantidade',restante) order by pos),'[]'::jsonb)
  from (
    select item,pos,q - least(q,greatest(0,p_quantidade-coalesce(sum(q) over (
      partition by item->>'produto_id' order by pos rows between unbounded preceding and 1 preceding),0)))::integer restante
    from (
      select item,pos,(item->>'quantidade')::integer q
      from jsonb_array_elements(p_itens) with ordinality a(item,pos)
      where item->>'produto_id'=p_produto::text and not (item ? 'pesagem')
    ) s
    union all
    select item,pos,(item->>'quantidade')::integer from jsonb_array_elements(p_itens) with ordinality a(item,pos)
      where item->>'produto_id'<>p_produto::text or item ? 'pesagem'
  ) s where restante>0;
$$;

drop function public.catalogo_ajuste_kds(uuid);

create or replace function public.catalogo_ajuste_kds(p_empresa uuid)
returns table(id uuid,nome text,codigo text,vendido_por_peso boolean,preco_quilo_centavos bigint) language sql stable security definer set search_path='' as $$
  select p.id,p.nome,p.codigo,p.vendido_por_peso,case when p.vendido_por_peso then p.preco_centavos end from public.produtos p where p.empresa_id=p_empresa and p.ativo
    and public.pode_editar_comanda_kds(p_empresa) order by p.nome,p.id;
$$;

create or replace function public.consultar_comanda_kds(p_empresa uuid,p_comanda bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'comanda',p.comanda,'cliente',p.cliente,'mesa',p.mesa,
    'encaminhar',p.mesa is null or public.comanda_protegida(p),'pendente',public.ajuste_comanda_pendente(p.id),
    'itens',(select jsonb_agg(case when i ? 'pesagem' then i else i - 'preco_centavos' end) from jsonb_array_elements(p.itens) i),
    'historico',coalesce((select jsonb_agg(to_jsonb(h) order by h.criado_em desc) from (
      select a.operacao,a.produto_nome,a.quantidade,a.motivo,a.estado,a.resolucao,a.criado_em
      from public.ajustes_comanda a where a.pedido_id=p.id order by a.criado_em desc limit 20
    ) h),'[]'::jsonb))
  from public.pedidos_online p where p.empresa_id=p_empresa and p.comanda=p_comanda
    and public.pode_editar_comanda_kds(p_empresa) and p.estado<>'recusado'
    and (p.estado<>'entregue' or (p.mesa is not null and not public.comanda_protegida(p))
      or public.ajuste_comanda_pendente(p.id));
$$;

revoke execute on function public.catalogo_ajuste_kds(uuid) from public,anon;
grant execute on function public.catalogo_ajuste_kds(uuid) to authenticated;

commit;
