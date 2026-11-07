begin;

alter table public.equipe_kds add column edita_comanda boolean not null default false;
alter table public.pedidos_online add column itens_preparo_original jsonb;
alter table public.pedidos_online drop constraint pedidos_online_total_centavos_check;
alter table public.pedidos_online add check (total_centavos > 0 or (total_centavos = 0 and estado = 'recusado'));

create table public.ajustes_comanda (
  id uuid primary key,
  pedido_id uuid not null references public.pedidos_online(id),
  autor uuid not null references auth.users(id),
  operacao text not null check (operacao in ('adicionar','retirar')),
  produto_id uuid not null references public.produtos(id),
  produto_nome text not null,
  quantidade integer not null check (quantidade between 1 and 100),
  motivo text not null,
  criado_em timestamptz not null default now(),
  estado text not null check (estado in ('pendente','aplicado','encerrado')),
  resolvido_por uuid references auth.users(id),
  resolvido_em timestamptz,
  resolucao text,
  antes jsonb,
  depois jsonb
);
create unique index ajustes_comanda_pendente on public.ajustes_comanda(pedido_id) where estado='pendente';
create index on public.ajustes_comanda(pedido_id,criado_em);
alter table public.ajustes_comanda enable row level security;
revoke all on public.ajustes_comanda from public,anon,authenticated;

create function public.eh_gestor_kds(p_empresa uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid() and papel='gestor');
$$;

create function public.pode_editar_comanda_kds(p_empresa uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.eh_gestor_kds(p_empresa) or exists(
    select 1 from public.equipe_kds where empresa_id=p_empresa and usuario_id=auth.uid() and edita_comanda);
$$;

create function public.configurar_edicao_kds(p_empresa uuid,p_email text,p_permitir boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.eh_gestor_kds(p_empresa) then raise exception 'Acesso administrativo necessário.' using errcode='42501'; end if;
  update public.equipe_kds k set edita_comanda=p_permitir from auth.users u
    where k.empresa_id=p_empresa and k.usuario_id=u.id and lower(u.email)=lower(btrim(p_email));
  if not found then raise exception 'Conta de cozinha não vinculada a esta loja.'; end if;
end;
$$;

create function public.ajuste_comanda_pendente(p_pedido uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.ajustes_comanda where pedido_id=p_pedido and estado='pendente');
$$;

create function public.comanda_protegida(p public.pedidos_online)
returns boolean language sql stable set search_path='' as $$
  select p.pix_sandbox_solicitado or p.pix_sandbox_cobranca_id is not null or p.pix_sandbox_confirmado_em is not null
    or exists(select 1 from public.pagamentos_online where pedido_id=p.id)
    or exists(select 1 from public.vendas where id=p.id)
    or exists(select 1 from remo.solicitacoes where origem='r_sistemas' and solicitante=p.empresa_id and referencia=p.id::text);
$$;

create function public.quantidade_item(p_itens jsonb,p_produto uuid)
returns integer language sql immutable set search_path='' as $$
  select coalesce(sum(i.quantidade),0)::integer from jsonb_to_recordset(p_itens) i(produto_id uuid,quantidade integer)
  where i.produto_id=p_produto;
$$;

create function public.reduzir_item_comanda(p_itens jsonb,p_produto uuid,p_quantidade integer)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_agg(item || jsonb_build_object('quantidade',restante) order by pos),'[]'::jsonb)
  from (
    select item,pos,q - least(q,greatest(0,p_quantidade-coalesce(sum(q) over (
      partition by item->>'produto_id' order by pos rows between unbounded preceding and 1 preceding),0)))::integer restante
    from (
      select item,pos,(item->>'quantidade')::integer q
      from jsonb_array_elements(p_itens) with ordinality a(item,pos)
      where item->>'produto_id'=p_produto::text
    ) s
    union all
    select item,pos,(item->>'quantidade')::integer from jsonb_array_elements(p_itens) with ordinality a(item,pos)
      where item->>'produto_id'<>p_produto::text
  ) s where restante>0;
$$;

create function public.itens_originais_comanda(p public.pedidos_online)
returns jsonb language plpgsql stable set search_path='' as $$
declare originais jsonb:=p.itens; i record;
begin
  if p.itens_preparo_original is not null then return p.itens_preparo_original; end if;
  -- Legacy orders can have supplements only after delivery of the original items.
  for i in select x.produto_id,sum(x.quantidade)::integer quantidade
    from public.adicionais_comanda a cross join lateral jsonb_to_recordset(a.itens) x(produto_id uuid,quantidade integer)
    where a.pedido_id=p.id group by x.produto_id
  loop
    originais:=public.reduzir_item_comanda(originais,i.produto_id,i.quantidade);
  end loop;
  return originais;
end;
$$;

-- Runs with the parent order already locked. The kitchen can remove only units not yet in preparation.
create function public.retirar_item_comanda(p public.pedidos_online,p_produto uuid,p_quantidade integer,p_gestor boolean)
returns void language plpgsql set search_path='' as $$
declare originais jsonb:=public.itens_originais_comanda(p); atualizados jsonb;
  originais_restantes jsonb;
  lote public.adicionais_comanda; falta integer:=p_quantidade; retirar integer; em_lotes integer;
begin
  if public.quantidade_item(p.itens,p_produto)<p_quantidade then raise exception 'A quantidade mudou. Confira os itens da comanda.'; end if;
  select coalesce(sum(public.quantidade_item(a.itens,p_produto)),0)::integer into em_lotes
    from public.adicionais_comanda a where a.pedido_id=p.id;
  falta:=greatest(0,falta-greatest(0,public.quantidade_item(p.itens,p_produto)
    -public.quantidade_item(originais,p_produto)-em_lotes));
  for lote in select * from public.adicionais_comanda a where a.pedido_id=p.id
    and (a.estado='novo' or p_gestor) and public.quantidade_item(a.itens,p_produto)>0
    order by (a.estado='novo') desc,a.criado_em desc,a.id for update
  loop
    exit when falta=0;
    retirar:=least(falta,public.quantidade_item(lote.itens,p_produto));
    atualizados:=public.reduzir_item_comanda(lote.itens,p_produto,retirar);
    update public.adicionais_comanda set itens=atualizados,
      estado=case when atualizados='[]'::jsonb then 'entregue' else lote.estado end where id=lote.id;
    falta:=falta-retirar;
  end loop;
  if falta>0 and p.estado<>'novo' and not p_gestor then
    raise exception 'A retirada de um item em preparo, pronto ou entregue exige autorização do gestor.' using errcode='P2001';
  end if;
  atualizados:=public.reduzir_item_comanda(p.itens,p_produto,p_quantidade);
  originais_restantes:=public.reduzir_item_comanda(originais,p_produto,falta);
  update public.pedidos_online set itens=atualizados,
    itens_preparo_original=originais_restantes,
    total_centavos=(select coalesce(sum(i.quantidade*i.preco_centavos),0)
      from jsonb_to_recordset(atualizados) i(quantidade integer,preco_centavos bigint)),
    estado=case when atualizados='[]'::jsonb then 'recusado'
      when originais_restantes='[]'::jsonb and p.estado in ('novo','preparo') then 'pronto'
      else p.estado end where id=p.id;
end;
$$;

create function public.gravar_adicionais_comanda(p public.pedidos_online,p_id uuid,p_itens jsonb)
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
  update public.pedidos_online set itens=reunidos,total_centavos=valor,
    itens_preparo_original=originais where id=p.id;
end;
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
    or public.ajuste_comanda_pendente(p.id)
    or exists(select 1 from public.pagamentos_online where pedido_id=p.id) then
    raise exception 'Adicionais disponíveis apenas em comandas de mesa entregues e sem cobrança online ou recebimento.';
  end if;
  perform public.gravar_adicionais_comanda(p,p_id,p_itens);
  select * into p from public.pedidos_online where id=p_pedido;
  return jsonb_build_object('id',p.id,'total_centavos',p.total_centavos,'itens',p.itens);
end;
$$;

create function public.aplicar_ajuste_comanda(a public.ajustes_comanda,p public.pedidos_online)
returns void language plpgsql set search_path='' as $$
begin
  if p.estado='recusado' or public.comanda_protegida(p) then
    raise exception 'Comanda com cobrança, pagamento ou despacho. Trate a alteração pelo caixa ou gestor.';
  end if;
  update public.ajustes_comanda set estado='aplicado' where id=a.id;
  if a.operacao='adicionar' then
    perform public.gravar_adicionais_comanda(p,a.id,jsonb_build_array(
      jsonb_build_object('produto_id',a.produto_id,'quantidade',a.quantidade)));
  else
    perform public.retirar_item_comanda(p,a.produto_id,a.quantidade,public.eh_gestor_kds(p.empresa_id));
  end if;
  update public.ajustes_comanda set estado='aplicado',resolvido_por=auth.uid(),resolvido_em=now(),
    antes=p.itens,depois=(select itens from public.pedidos_online where id=p.id) where id=a.id;
end;
$$;

create function public.registrar_ajuste_kds(p_empresa uuid,p_pedido uuid,p_id uuid,p_operacao text,p_produto uuid,p_quantidade integer,p_motivo text)
returns text language plpgsql security definer set search_path='' as $$
declare p public.pedidos_online; a public.ajustes_comanda; nome text;
begin
  if not public.pode_editar_comanda_kds(p_empresa) then raise exception 'Permissão de edição da cozinha necessária.' using errcode='42501'; end if;
  select * into p from public.pedidos_online where id=p_pedido and empresa_id=p_empresa for update;
  if not found then raise exception 'Comanda indisponível.'; end if;
  select * into a from public.ajustes_comanda where id=p_id;
  if found then
    if a.pedido_id<>p_pedido or a.autor<>auth.uid() or a.operacao<>p_operacao or a.produto_id<>p_produto
      or a.quantidade<>p_quantidade or a.motivo<>btrim(p_motivo) then raise exception 'Identificador de ajuste já usado.'; end if;
    return a.estado;
  end if;
  if p.estado='recusado' or public.ajuste_comanda_pendente(p.id) then raise exception 'Comanda indisponível para novo ajuste.'; end if;
  if p_id is null or p_operacao is null or p_operacao not in ('adicionar','retirar') or p_quantidade is null
    or p_quantidade not between 1 and 100 or p_motivo is null or length(btrim(p_motivo)) not between 3 and 240
    then raise exception 'Confira a ação, quantidade e motivo.'; end if;
  if p_operacao='adicionar' then
    select pr.nome into nome from public.produtos pr where pr.id=p_produto and pr.empresa_id=p_empresa and pr.ativo;
  else
    select item->>'nome' into nome from jsonb_array_elements(p.itens) item where item->>'produto_id'=p_produto::text limit 1;
    if public.quantidade_item(p.itens,p_produto)<p_quantidade then raise exception 'Quantidade indisponível na comanda.'; end if;
  end if;
  if nome is null then raise exception 'Produto indisponível.'; end if;
  insert into public.ajustes_comanda(id,pedido_id,autor,operacao,produto_id,produto_nome,quantidade,motivo,estado)
    values(p_id,p.id,auth.uid(),p_operacao,p_produto,nome,p_quantidade,btrim(p_motivo),'pendente') returning * into a;
  if p.mesa is null or public.comanda_protegida(p) then return 'pendente'; end if;
  begin
    perform public.aplicar_ajuste_comanda(a,p);
  exception when sqlstate 'P2001' then
    return 'pendente';
  end;
  return 'aplicado';
end;
$$;

create function public.resolver_ajuste_comanda(p_id uuid,p_aplicar boolean,p_resolucao text)
returns void language plpgsql security definer set search_path='' as $$
declare p public.pedidos_online; a public.ajustes_comanda;
begin
  select po.* into p from public.pedidos_online po join public.ajustes_comanda ac on ac.pedido_id=po.id
    where ac.id=p_id and exists(select 1 from public.membros m where m.empresa_id=po.empresa_id and m.usuario_id=auth.uid()) for update of po;
  if not found then raise exception 'Solicitação indisponível.'; end if;
  if p_aplicar is null or p_resolucao is null or length(btrim(p_resolucao)) not between 3 and 240 then
    raise exception 'Informe como a solicitação foi resolvida.';
  end if;
  select * into a from public.ajustes_comanda where id=p_id and estado='pendente';
  if not found then raise exception 'Solicitação já resolvida.'; end if;
  if p_aplicar then perform public.aplicar_ajuste_comanda(a,p);
  else update public.ajustes_comanda set estado='encerrado',resolvido_por=auth.uid(),resolvido_em=now() where id=a.id;
  end if;
  update public.ajustes_comanda set resolucao=btrim(p_resolucao) where id=a.id;
end;
$$;

create function public.catalogo_ajuste_kds(p_empresa uuid)
returns table(id uuid,nome text,codigo text) language sql stable security definer set search_path='' as $$
  select p.id,p.nome,p.codigo from public.produtos p where p.empresa_id=p_empresa and p.ativo
    and public.pode_editar_comanda_kds(p_empresa) order by p.nome,p.id;
$$;

create function public.consultar_comanda_kds(p_empresa uuid,p_comanda bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'comanda',p.comanda,'cliente',p.cliente,'mesa',p.mesa,
    'encaminhar',p.mesa is null or public.comanda_protegida(p),'pendente',public.ajuste_comanda_pendente(p.id),
    'itens',(select jsonb_agg(i - 'preco_centavos') from jsonb_array_elements(p.itens) i),
    'historico',coalesce((select jsonb_agg(to_jsonb(h) order by h.criado_em desc) from (
      select a.operacao,a.produto_nome,a.quantidade,a.motivo,a.estado,a.resolucao,a.criado_em
      from public.ajustes_comanda a where a.pedido_id=p.id order by a.criado_em desc limit 20
    ) h),'[]'::jsonb))
  from public.pedidos_online p where p.empresa_id=p_empresa and p.comanda=p_comanda
    and public.pode_editar_comanda_kds(p_empresa) and p.estado<>'recusado'
    and (p.estado<>'entregue' or (p.mesa is not null and not public.comanda_protegida(p))
      or public.ajuste_comanda_pendente(p.id));
$$;

create function public.ajustes_pendentes_caixa(p_empresa uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.criado_em),'[]'::jsonb) from (
    select a.id,a.operacao,a.produto_nome,a.quantidade,a.motivo,a.criado_em,p.comanda,p.cliente,p.mesa,
      public.comanda_protegida(p) protegido
    from public.ajustes_comanda a join public.pedidos_online p on p.id=a.pedido_id
    where p.empresa_id=p_empresa and a.estado='pendente' and exists (
      select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid())
    order by a.criado_em limit 100
  ) s;
$$;

alter function public.fila_cozinha(uuid) rename to fila_cozinha_com_adicionais;
revoke execute on function public.fila_cozinha_com_adicionais(uuid) from public,anon,authenticated;
create function public.fila_cozinha(p_empresa uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(
    f.item || jsonb_build_object('edita_comanda',public.pode_editar_comanda_kds(p_empresa),
      'ajuste_pendente',public.ajuste_comanda_pendente(p.id)) ||
      case when f.item ? 'adicional' then jsonb_build_object('recebido',
        exists(select 1 from public.vendas where id=p.id)) else '{}'::jsonb end ||
      case when f.item ? 'adicional' or p.itens_preparo_original is null then '{}'::jsonb
      else jsonb_build_object('itens',coalesce((select jsonb_agg(i - array['preco_centavos','produto_id'])
        from jsonb_array_elements(p.itens_preparo_original) i),'[]'::jsonb)) end
    order by f.pos),'[]'::jsonb)
  from jsonb_array_elements(public.fila_cozinha_com_adicionais(p_empresa)) with ordinality f(item,pos)
  join public.pedidos_online p on p.id=coalesce(f.item->>'pedido_id',f.item->>'id')::uuid;
$$;

create or replace function public.avancar_adicional_comanda(p_id uuid,p_estado text)
returns void language plpgsql security definer set search_path='' as $$
declare pedido public.pedidos_online;
begin
  select p.* into pedido from public.pedidos_online p join public.adicionais_comanda a on a.pedido_id=p.id
    where a.id=p_id and p.estado<>'recusado' and public.pode_operar_cozinha(p.empresa_id) for update of p;
  if not found then raise exception 'Adicional indisponível.'; end if;
  if public.ajuste_comanda_pendente(pedido.id) then raise exception 'Aguarde a resolução do ajuste da comanda.'; end if;
  if p_estado='entregue' and pedido.mesa is null and not exists(select 1 from public.vendas where id=pedido.id) then
    raise exception 'Registre o recebimento antes de entregar.';
  end if;
  update public.adicionais_comanda set estado=p_estado where id=p_id
    and ((estado='novo' and p_estado='preparo') or (estado='preparo' and p_estado='pronto')
      or (estado='pronto' and p_estado='entregue'));
  if not found then raise exception 'Transição inválida.'; end if;
end;
$$;

create function public.proteger_andamento_ajuste()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.estado is distinct from old.estado and public.ajuste_comanda_pendente(old.id) then
    raise exception 'Aguarde a resolução do ajuste da comanda.';
  end if;
  if new.estado='entregue' and old.estado<>'entregue' and old.mesa is null and exists (
    select 1 from public.adicionais_comanda where pedido_id=old.id and estado<>'entregue'
  ) then raise exception 'Conclua os adicionais antes de entregar.'; end if;
  if new.estado='recusado' and old.estado<>'recusado' and exists (
    select 1 from public.adicionais_comanda where pedido_id=old.id and estado<>'entregue'
  ) then raise exception 'A comanda ainda tem adicionais em andamento.'; end if;
  return new;
end;
$$;
create trigger proteger_andamento_ajuste before update of estado on public.pedidos_online
for each row execute function public.proteger_andamento_ajuste();

create or replace function public.proteger_recebimento_adicionais()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.pedidos_online where id=new.id for update;
  if public.ajuste_comanda_pendente(new.id) then raise exception 'Resolva o ajuste antes de receber a comanda.'; end if;
  if exists(select 1 from public.adicionais_comanda a join public.pedidos_online p on p.id=a.pedido_id
    where a.pedido_id=new.id and (a.estado in ('novo','preparo') or (p.mesa is not null and a.estado='pronto'))) then
    raise exception 'Conclua os adicionais antes de receber a comanda.';
  end if;
  return new;
end;
$$;

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

revoke execute on function public.eh_gestor_kds(uuid),public.pode_editar_comanda_kds(uuid),
  public.ajuste_comanda_pendente(uuid),public.comanda_protegida(public.pedidos_online),
  public.quantidade_item(jsonb,uuid),public.reduzir_item_comanda(jsonb,uuid,integer),
  public.itens_originais_comanda(public.pedidos_online),public.gravar_adicionais_comanda(public.pedidos_online,uuid,jsonb),
  public.retirar_item_comanda(public.pedidos_online,uuid,integer,boolean),
  public.aplicar_ajuste_comanda(public.ajustes_comanda,public.pedidos_online),public.proteger_andamento_ajuste()
  from public,anon,authenticated;
revoke execute on function public.configurar_edicao_kds(uuid,text,boolean),public.catalogo_ajuste_kds(uuid),
  public.consultar_comanda_kds(uuid,bigint),public.ajustes_pendentes_caixa(uuid),public.fila_cozinha(uuid),
  public.registrar_ajuste_kds(uuid,uuid,uuid,text,uuid,integer,text),public.resolver_ajuste_comanda(uuid,boolean,text)
  from public,anon;
grant execute on function public.configurar_edicao_kds(uuid,text,boolean),public.catalogo_ajuste_kds(uuid),
  public.consultar_comanda_kds(uuid,bigint),public.ajustes_pendentes_caixa(uuid),public.fila_cozinha(uuid),
  public.registrar_ajuste_kds(uuid,uuid,uuid,text,uuid,integer,text),public.resolver_ajuste_comanda(uuid,boolean,text),
  public.pode_editar_comanda_kds(uuid)
  to authenticated;

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
    insert into public.itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos)
      select p_pedido,i.produto_id,i.nome,i.quantidade,i.preco_centavos
      from jsonb_to_recordset(v_pedido.itens) i(produto_id uuid,nome text,quantidade integer,preco_centavos bigint);
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

create function public.receber_comanda_conferida(p_caixa uuid,p_pedido uuid,p_meio text,p_total bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare c public.caixas; valor bigint;
begin
  c:=public.caixa_do_operador(p_caixa);
  select total_centavos into valor from public.pedidos_online
    where id=p_pedido and empresa_id=c.empresa_id for update;
  if not found or valor is distinct from p_total then
    raise exception 'O total da comanda mudou. Confira o novo valor antes de receber.';
  end if;
  return public.receber_pedido_no_caixa(p_caixa,p_pedido,p_meio);
end;
$$;
revoke execute on function public.receber_comanda_conferida(uuid,uuid,text,bigint) from public,anon;
grant execute on function public.receber_comanda_conferida(uuid,uuid,text,bigint) to authenticated;

create or replace function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos, p.itens, exists(select 1 from public.adicionais_comanda a where a.pedido_id=p.id and a.estado<>'entregue') as adicionais_pendentes,
      public.ajuste_comanda_pendente(p.id) as ajuste_pendente
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

commit;
