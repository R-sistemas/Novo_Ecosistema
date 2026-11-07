begin;
alter table public.vendas add column desconto_centavos bigint not null default 0 check (desconto_centavos >= 0);
create function public.registrar_venda_com_desconto(p_caixa uuid, p_venda uuid, p_meio text, p_itens jsonb, p_desconto bigint)
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
    join public.produtos p on p.id = i.produto_id and p.empresa_id = v_caixa.empresa_id and p.ativo;
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


create or replace function public.comandas_pendentes(p_empresa uuid, p_busca text default '')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.comanda), '[]'::jsonb) from (
    select p.id, p.comanda, p.mesa, p.cliente, p.total_centavos, p.itens
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

create or replace function public.registrar_venda(p_caixa uuid,p_venda uuid,p_meio text,p_itens jsonb)
returns bigint language sql security definer set search_path = '' as $$
  select public.registrar_venda_com_desconto(p_caixa,p_venda,p_meio,p_itens,0);
$$;

revoke execute on function public.registrar_venda_com_desconto(uuid,uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.registrar_venda_com_desconto(uuid,uuid,text,jsonb,bigint) to authenticated;
commit;
