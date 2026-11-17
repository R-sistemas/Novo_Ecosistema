begin;

create table public.pix_balcao (
  id uuid primary key,
  caixa_id uuid not null references public.caixas(id),
  itens jsonb not null,
  valor_centavos bigint not null check (valor_centavos > 0),
  ordem_id text unique,
  confirmado_em timestamptz
);
alter table public.pix_balcao enable row level security;
revoke all on public.pix_balcao from public, anon, authenticated;

create function public.reservar_pix_balcao(p_caixa uuid, p_venda uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_pix public.pix_balcao;
  v_itens jsonb;
  v_total bigint;
  v_qtd integer;
begin
  v_caixa := public.caixa_do_operador(p_caixa);
  if not exists (select 1 from public.empresas where id = v_caixa.empresa_id and cardapio_slug = 'quiosque-dorafa')
    then raise exception 'Pix presencial indisponível nesta loja.'; end if;
  select * into v_pix from public.pix_balcao where id = p_venda;
  if found then
    if v_pix.caixa_id <> p_caixa then raise exception 'Cobrança indisponível.'; end if;
  else
    if v_caixa.fechado_em is not null or jsonb_typeof(p_itens) is distinct from 'array'
      then raise exception 'Caixa fechado ou carrinho inválido.'; end if;
    v_qtd := jsonb_array_length(p_itens);
    if v_qtd not between 1 and 100 then raise exception 'Carrinho inválido.'; end if;
    select jsonb_agg(jsonb_build_object('produto_id',p.id,'nome',p.nome,
        'quantidade',i.quantidade,'preco_centavos',p.preco_centavos)),
        sum(p.preco_centavos * i.quantidade)
      into v_itens,v_total
      from jsonb_to_recordset(p_itens) i(produto_id uuid,quantidade integer)
      join public.produtos p on p.id=i.produto_id and p.empresa_id=v_caixa.empresa_id and p.ativo
      where i.quantidade between 1 and 1000;
    if v_itens is null or jsonb_array_length(v_itens) <> v_qtd
      or (select count(distinct i.produto_id) from jsonb_to_recordset(v_itens) i(produto_id uuid)) <> v_qtd
      then raise exception 'Produto ou quantidade indisponível.'; end if;
    insert into public.pix_balcao(id,caixa_id,itens,valor_centavos)
      values(p_venda,p_caixa,v_itens,v_total) returning * into v_pix;
  end if;
  return jsonb_build_object('total_centavos',v_pix.valor_centavos,'ordem',v_pix.ordem_id,
    'confirmado',v_pix.confirmado_em is not null);
end;
$$;

create function public.conciliar_pix_balcao(p_venda uuid,p_ordem text,p_valor bigint,p_confirmado boolean)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_caixa public.caixas;
  v_pix public.pix_balcao;
begin
  select c.* into v_caixa from public.caixas c join public.pix_balcao b on b.caixa_id=c.id
    where b.id=p_venda for update of c;
  if not found then return false; end if;
  select * into v_pix from public.pix_balcao where id=p_venda for update;
  if v_pix.valor_centavos <> p_valor or (v_pix.ordem_id is not null and v_pix.ordem_id <> p_ordem)
    then return false; end if;
  if v_pix.confirmado_em is not null then return true; end if;
  if p_confirmado then
    if v_caixa.fechado_em is not null then raise exception 'Caixa fechado para conciliação.'; end if;
    insert into public.vendas(id,caixa_id,empresa_id,total_centavos,meio)
      values(p_venda,v_caixa.id,v_caixa.empresa_id,p_valor,'pix');
    insert into public.itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos)
      select p_venda,i.produto_id,i.nome,i.quantidade,i.preco_centavos
      from jsonb_to_recordset(v_pix.itens) i(produto_id uuid,nome text,quantidade integer,preco_centavos bigint);
    insert into public.movimentos_caixa(empresa_id,caixa_id,tipo,valor_centavos,meio)
      values(v_caixa.empresa_id,v_caixa.id,'venda',p_valor,'pix');
  end if;
  update public.pix_balcao set ordem_id=p_ordem,
    confirmado_em=case when p_confirmado then now() else null end where id=p_venda;
  return true;
end;
$$;

revoke execute on function public.reservar_pix_balcao(uuid,uuid,jsonb), public.conciliar_pix_balcao(uuid,text,bigint,boolean)
  from public, anon, authenticated;
grant execute on function public.reservar_pix_balcao(uuid,uuid,jsonb) to authenticated;
grant execute on function public.conciliar_pix_balcao(uuid,text,bigint,boolean) to service_role;

commit;
