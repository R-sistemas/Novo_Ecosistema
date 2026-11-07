begin;
alter table public.produtos add column visivel_cardapio boolean not null default true;
alter table public.produtos add column preparo_cozinha boolean not null default true;

-- Each supplement has its own preparation state and immutable request for retries.
create table public.adicionais_comanda (
  id uuid primary key,
  pedido_id uuid not null references public.pedidos_online(id),
  usuario_id uuid not null references auth.users(id),
  solicitado jsonb not null,
  itens jsonb not null,
  estado text not null check (estado in ('novo','preparo','pronto','entregue')),
  criado_em timestamptz not null default now()
);
create index on public.adicionais_comanda(pedido_id);
alter table public.adicionais_comanda enable row level security;
revoke all on public.adicionais_comanda from public,anon,authenticated;

create function public.adicionar_itens_comanda(p_caixa uuid,p_pedido uuid,p_id uuid,p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.caixas; p public.pedidos_online; a public.adicionais_comanda;
  novos jsonb; preparo jsonb; reunidos jsonb; valor bigint;
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
    or exists(select 1 from public.pagamentos_online where pedido_id=p.id) then
    raise exception 'Adicionais disponíveis apenas em comandas de mesa entregues e sem cobrança online ou recebimento.';
  end if;
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
  join public.produtos pr on pr.id=i.produto_id and pr.empresa_id=p.empresa_id and pr.ativo
  left join lateral (select x as old from jsonb_array_elements(p.itens) x where x->>'produto_id'=pr.id::text limit 1) o on true;
  if novos is null or jsonb_array_length(novos)<>jsonb_array_length(p_itens) then raise exception 'Produto indisponível.'; end if;
  select jsonb_agg(jsonb_build_object('produto_id',produto_id,'nome',nome,'preco_centavos',preco_centavos,'quantidade',quantidade) order by produto_id),
    sum(preco_centavos*quantidade) into reunidos,valor from (
    select produto_id,nome,preco_centavos,sum(quantidade)::integer quantidade
    from jsonb_to_recordset(p.itens || novos) i(produto_id uuid,nome text,preco_centavos bigint,quantidade integer)
    group by produto_id,nome,preco_centavos
  ) s;
  if exists(select 1 from jsonb_array_elements(reunidos) x where (x->>'quantidade')::integer>1000)
    then raise exception 'Quantidade acumulada acima do limite.'; end if;
  insert into public.adicionais_comanda(id,pedido_id,usuario_id,solicitado,itens,estado)
    values(p_id,p.id,auth.uid(),p_itens,preparo,case when jsonb_array_length(preparo)>0 then 'novo' else 'entregue' end);
  update public.pedidos_online set itens=reunidos,total_centavos=valor where id=p.id;
  return jsonb_build_object('id',p.id,'total_centavos',valor,'itens',reunidos);
end;
$$;
revoke execute on function public.adicionar_itens_comanda(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.adicionar_itens_comanda(uuid,uuid,uuid,jsonb) to authenticated;

create function public.avancar_adicional_comanda(p_id uuid,p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.adicionais_comanda a set estado=p_estado from public.pedidos_online p
  where a.id=p_id and p.id=a.pedido_id and public.pode_operar_cozinha(p.empresa_id)
    and ((a.estado='novo' and p_estado='preparo') or (a.estado='preparo' and p_estado='pronto')
      or (a.estado='pronto' and p_estado='entregue'));
  if not found then raise exception 'Adicional indisponível ou transição inválida.'; end if;
end;
$$;
revoke execute on function public.avancar_adicional_comanda(uuid,text) from public,anon;
grant execute on function public.avancar_adicional_comanda(uuid,text) to authenticated;

alter function public.fila_cozinha(uuid) rename to fila_cozinha_original;
revoke execute on function public.fila_cozinha_original(uuid) from public,anon,authenticated;
create function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.fila_cozinha_original(p_empresa) || coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'adicional',true,'pedido_id',p.id,'cliente',p.cliente,
      'mesa',p.mesa,'comanda',p.comanda,'itens',a.itens,'estado',a.estado,'criado_em',a.criado_em,'recebido',false)
      order by a.criado_em,a.id)
    from public.adicionais_comanda a join public.pedidos_online p on p.id=a.pedido_id
    where p.empresa_id=p_empresa and a.estado<>'entregue' and public.pode_operar_cozinha(p_empresa)
  ),'[]'::jsonb);
$$;
revoke execute on function public.fila_cozinha(uuid) from public,anon;
grant execute on function public.fila_cozinha(uuid) to authenticated;

-- Receipt must never bypass outstanding preparation, including direct RPC calls.
create function public.proteger_recebimento_adicionais()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.pedidos_online where id=new.id for update;
  if exists(select 1 from public.adicionais_comanda where pedido_id=new.id and estado<>'entregue') then
    raise exception 'Entregue os adicionais antes de receber a comanda.';
  end if;
  return new;
end;
$$;
revoke execute on function public.proteger_recebimento_adicionais() from public,anon,authenticated;
create trigger proteger_recebimento_adicionais before insert on public.vendas
for each row execute function public.proteger_recebimento_adicionais();
create or replace function public.enviar_pedido(p_slug text, p_id uuid, p_cliente text, p_mesa uuid, p_itens jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_mesa integer;
  v_itens jsonb;
  v_total bigint;
begin
  select id into v_empresa from public.empresas where cardapio_slug = p_slug;
  if v_empresa is null then raise exception 'Cardápio indisponível.'; end if;
  if p_mesa is not null then
    select numero into v_mesa from public.mesas_cardapio where token = p_mesa and empresa_id = v_empresa;
    if not found then raise exception 'Mesa inválida.'; end if;
  end if;
  if p_id is null or p_cliente is null or length(btrim(p_cliente)) not between 1 and 100
    or jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'Dados do pedido inválidos.';
  end if;
  if jsonb_array_length(p_itens) not between 1 and 30 then raise exception 'Carrinho inválido.'; end if;

  with itens as (
    select i.produto_id, i.quantidade
    from jsonb_to_recordset(p_itens) as i(produto_id uuid, quantidade integer)
  )
  select jsonb_agg(jsonb_build_object('produto_id', p.id, 'nome', p.nome,
    'quantidade', i.quantidade, 'preco_centavos', p.preco_centavos) order by p.id),
    sum(p.preco_centavos * i.quantidade)
  into v_itens, v_total
  from itens i join public.produtos p on p.id = i.produto_id and p.empresa_id = v_empresa and p.ativo and p.visivel_cardapio
  where i.quantidade between 1 and 100;

  if v_itens is null or jsonb_array_length(v_itens) <> jsonb_array_length(p_itens) then
    raise exception 'Item indisponível ou quantidade inválida.';
  end if;
  insert into public.pedidos_online(id, empresa_id, cliente, mesa, itens, total_centavos)
    values (p_id, v_empresa, btrim(p_cliente), v_mesa, v_itens, v_total)
    on conflict (id) do nothing;
  if not found and not exists (select 1 from public.pedidos_online p where p.id = p_id
    and p.empresa_id = v_empresa and p.cliente = btrim(p_cliente)
    and p.mesa is not distinct from v_mesa and p.itens = v_itens) then
    raise exception 'Identificador de pedido já utilizado.';
  end if;
  return p_id;
end;
$$;
create or replace function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', e.nome, 'cor', e.cardapio_cor, 'fundo', e.cardapio_fundo,
    'logo',e.cardapio_logo,'agradecimento',e.cardapio_agradecimento,'produtos',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'preco_centavos',p.preco_centavos,
      'categoria',p.categoria,'descricao',p.descricao,'composicao',p.composicao,
      'foto',md5(p.foto_cardapio),'queridinho',p.queridinho) order by p.nome)
    from public.produtos p where p.empresa_id=e.id and p.ativo and p.visivel_cardapio
  ),'[]'::jsonb))
  from public.empresas e where e.cardapio_slug=p_slug;
$$;
create or replace function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos, p.itens, exists(select 1 from public.adicionais_comanda a where a.pedido_id=p.id and a.estado<>'entregue') as adicionais_pendentes
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
create or replace function public.foto_publica_cardapio(p_produto uuid,p_versao text)
returns text language sql stable security definer set search_path = '' as $$
  select p.foto_cardapio from public.produtos p join public.empresas e on e.id=p.empresa_id
    where p.id=p_produto and p.ativo and p.visivel_cardapio and e.cardapio_slug is not null and md5(p.foto_cardapio)=p_versao;
$$;
commit;
