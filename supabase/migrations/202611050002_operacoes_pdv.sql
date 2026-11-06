begin;

create table public.vendas (
  id uuid primary key,
  caixa_id uuid not null,
  empresa_id uuid not null,
  total_centavos bigint not null check (total_centavos > 0),
  meio text not null check (meio in ('dinheiro', 'pix', 'cartao')),
  criado_em timestamptz not null default now(),
  foreign key (empresa_id, caixa_id) references public.caixas(empresa_id, id)
);

create table public.itens_venda (
  venda_id uuid not null references public.vendas(id),
  produto_id uuid not null references public.produtos(id),
  nome text not null,
  quantidade integer not null check (quantidade > 0),
  preco_centavos bigint not null check (preco_centavos > 0),
  primary key (venda_id, produto_id)
);

alter table public.vendas enable row level security;
alter table public.itens_venda enable row level security;
revoke all on public.vendas, public.itens_venda from anon, authenticated;
grant select on public.vendas, public.itens_venda to authenticated;

create policy vendas_visiveis on public.vendas for select to authenticated
  using (exists (select 1 from public.caixas c where c.id = caixa_id));
create policy itens_visiveis on public.itens_venda for select to authenticated
  using (exists (select 1 from public.vendas v where v.id = venda_id));

create function public.abrir_caixa(p_empresa uuid, p_abertura bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_caixa uuid;
begin
  if not exists (select 1 from public.membros
    where empresa_id = p_empresa and usuario_id = auth.uid()) then
    raise exception 'Empresa indisponível.' using errcode = '42501';
  end if;
  insert into public.caixas (empresa_id, operador_id, abertura_centavos)
    values (p_empresa, auth.uid(), p_abertura) returning id into v_caixa;
  return v_caixa;
end;
$$;

create function public.caixa_do_operador(p_caixa uuid)
returns public.caixas language plpgsql security definer set search_path = '' as $$
declare v_caixa public.caixas;
begin
  select c.* into v_caixa from public.caixas c
    where c.id = p_caixa and c.operador_id = auth.uid()
      and exists (select 1 from public.membros m
        where m.empresa_id = c.empresa_id and m.usuario_id = auth.uid())
    for update of c;
  if not found then
    raise exception 'Caixa indisponível.' using errcode = '42501';
  end if;
  return v_caixa;
end;
$$;

create function public.saldo_caixa(p_caixa uuid, p_abertura bigint)
returns bigint language sql stable set search_path = '' as $$
  select p_abertura + coalesce(sum(
    case when tipo = 'sangria' then -valor_centavos else valor_centavos end
  ), 0) from public.movimentos_caixa where caixa_id = p_caixa and meio = 'dinheiro';
$$;

create index movimentos_por_caixa on public.movimentos_caixa (caixa_id);
create index vendas_por_caixa on public.vendas (caixa_id);

create function public.movimentar_caixa(p_caixa uuid, p_tipo text, p_valor bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_movimento uuid;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  if v_caixa.fechado_em is not null then raise exception 'Caixa fechado.'; end if;
  if p_tipo is null or p_tipo not in ('sangria', 'suprimento') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if p_tipo = 'sangria' and p_valor > public.saldo_caixa(p_caixa, v_caixa.abertura_centavos) then
    raise exception 'A sangria ultrapassa o saldo em dinheiro.';
  end if;
  insert into public.movimentos_caixa (empresa_id, caixa_id, tipo, valor_centavos, meio)
    values (v_caixa.empresa_id, p_caixa, p_tipo, p_valor, 'dinheiro') returning id into v_movimento;
  return v_movimento;
end;
$$;

create function public.fechar_caixa(p_caixa uuid, p_contado bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_caixa public.caixas;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  if v_caixa.fechado_em is not null then raise exception 'Caixa fechado.'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Valor contado inválido.'; end if;
  update public.caixas set fechado_em = now(), contado_centavos = p_contado where id = p_caixa;
  return public.saldo_caixa(p_caixa, v_caixa.abertura_centavos);
end;
$$;

create function public.registrar_venda(p_caixa uuid, p_venda uuid, p_meio text, p_itens jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_total bigint;
  v_itens jsonb;
  v_quantidade integer;
  v_venda public.vendas;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
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
    if v_venda.caixa_id is distinct from p_caixa or v_venda.meio is distinct from p_meio
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
    join public.produtos p on p.id = i.produto_id and p.empresa_id = v_caixa.empresa_id and p.ativo;
  if v_itens is null or jsonb_array_length(v_itens) <> v_quantidade then
    raise exception 'Produto indisponível.';
  end if;

  insert into public.vendas (id, caixa_id, empresa_id, total_centavos, meio)
    values (p_venda, p_caixa, v_caixa.empresa_id, v_total, p_meio);
  insert into public.itens_venda (venda_id, produto_id, nome, quantidade, preco_centavos)
    select p_venda, i.produto_id, i.nome, i.quantidade, i.preco_centavos
    from jsonb_to_recordset(v_itens) as i(produto_id uuid, nome text, quantidade integer, preco_centavos bigint);
  insert into public.movimentos_caixa (empresa_id, caixa_id, tipo, valor_centavos, meio)
    values (v_caixa.empresa_id, p_caixa, 'venda', v_total, p_meio);
  return v_total;
end;
$$;

revoke execute on function public.caixa_do_operador(uuid), public.saldo_caixa(uuid, bigint),
  public.abrir_caixa(uuid, bigint), public.movimentar_caixa(uuid, text, bigint),
  public.fechar_caixa(uuid, bigint), public.registrar_venda(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.abrir_caixa(uuid, bigint), public.movimentar_caixa(uuid, text, bigint),
  public.fechar_caixa(uuid, bigint), public.registrar_venda(uuid, uuid, text, jsonb) to authenticated;

commit;
