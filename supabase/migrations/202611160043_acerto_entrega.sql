begin;

create table remo.acertos_entrega (
  pedido_id uuid primary key references public.pedidos_online(id),
  ordem_remo uuid not null unique,
  metodo text not null check (metodo in ('dinheiro','maquininha')),
  valor_centavos bigint not null check (valor_centavos > 0),
  comprovante text,
  entregador jsonb not null default '{}'::jsonb,
  declarado_em timestamptz not null,
  confirmado_em timestamptz,
  caixa_id uuid references public.caixas(id),
  confirmado_por uuid references auth.users(id),
  maquininha_devolvida boolean not null default false,
  check (metodo = 'dinheiro' or nullif(btrim(comprovante),'') is not null),
  check ((confirmado_em is null and caixa_id is null and confirmado_por is null)
    or (confirmado_em is not null and caixa_id is not null and confirmado_por is not null))
);
alter table remo.acertos_entrega enable row level security;
revoke all on remo.acertos_entrega from public, anon, authenticated;

create function public.registrar_acerto_entrega(p_pedido uuid,p_ordem uuid,p_metodo text,
  p_valor bigint,p_comprovante text,p_entregador jsonb,p_declarado_em timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare s remo.solicitacoes; d public.entregas_pedido; p public.pedidos_online;
begin
  if not public.atualizar_despacho_integrado(p_pedido,p_ordem,'entregue') then
    raise exception 'Despacho REMO não vinculado ao pedido.';
  end if;
  select * into s from remo.solicitacoes where ordem_remo=p_ordem and referencia=p_pedido::text
    and origem='r_sistemas' for update;
  if not found or s.estado<>'entregue' or s.cobrar_na_entrega_centavos<>p_valor then
    raise exception 'Entrega ou cobrança divergente.';
  end if;
  select * into p from public.pedidos_online where id=p_pedido and empresa_id=s.solicitante;
  select * into d from public.entregas_pedido where pedido_id=p_pedido;
  if not found or d.pagamento<>'na_entrega' or p.total_centavos<>p_valor
    or d.endereco->>'metodo_pagamento' is distinct from p_metodo
    or p_metodo not in ('dinheiro','maquininha') or p_declarado_em is null
    or (p_metodo='maquininha' and nullif(btrim(p_comprovante),'') is null)
    or exists(select 1 from public.pagamentos_online where pedido_id=p_pedido)
  then raise exception 'Declaração de recebimento divergente.'; end if;
  insert into remo.acertos_entrega(pedido_id,ordem_remo,metodo,valor_centavos,comprovante,entregador,declarado_em)
    values(p_pedido,p_ordem,p_metodo,p_valor,nullif(btrim(p_comprovante),''),coalesce(p_entregador,'{}'::jsonb),p_declarado_em)
    on conflict (pedido_id) do update set pedido_id=excluded.pedido_id
      where remo.acertos_entrega.ordem_remo=excluded.ordem_remo
        and remo.acertos_entrega.metodo=excluded.metodo
        and remo.acertos_entrega.valor_centavos=excluded.valor_centavos
        and remo.acertos_entrega.comprovante is not distinct from excluded.comprovante;
  if not found then raise exception 'Declaração já registrada com outros dados.'; end if;
  return true;
end;
$$;

create function public.acertos_entrega_pendentes(p_empresa uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.declarado_em),'[]'::jsonb) from (
    select x.pedido_id,p.comanda,p.cliente,x.metodo,x.valor_centavos,x.comprovante,
      x.entregador,x.declarado_em,x.ordem_remo
    from remo.acertos_entrega x join public.pedidos_online p on p.id=x.pedido_id
    where p.empresa_id=p_empresa and x.confirmado_em is null
      and exists(select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid())
    order by x.declarado_em limit 100
  ) a;
$$;

create function public.confirmar_acerto_entrega(p_caixa uuid,p_pedido uuid,p_meio text,
  p_total bigint,p_comprovante text,p_maquininha_devolvida boolean)
returns bigint language plpgsql security definer set search_path='' as $$
declare c public.caixas; p public.pedidos_online; a remo.acertos_entrega; meio text;
begin
  c:=public.caixa_do_operador(p_caixa);
  if c.fechado_em is not null then raise exception 'Abra o caixa antes de confirmar o acerto.'; end if;
  select * into a from remo.acertos_entrega where pedido_id=p_pedido for update;
  if not found or a.confirmado_em is not null then raise exception 'Acerto indisponível ou já confirmado.'; end if;
  select * into p from public.pedidos_online where id=p_pedido and empresa_id=c.empresa_id for update;
  if not found or p.total_centavos<>p_total or a.valor_centavos<>p_total then
    raise exception 'Valor divergente. Confira a comanda.';
  end if;
  meio:=case when a.metodo='maquininha' then 'cartao' else 'dinheiro' end;
  if p_meio is distinct from meio then raise exception 'Meio de pagamento divergente.'; end if;
  if a.metodo='maquininha' and (p_comprovante is distinct from a.comprovante
    or p_maquininha_devolvida is distinct from true) then
    raise exception 'Confira o comprovante e a devolução da maquininha.';
  end if;
  if exists(select 1 from public.vendas where id=p_pedido) then
    raise exception 'Pedido já recebido no caixa.';
  end if;
  insert into public.vendas(id,caixa_id,empresa_id,total_centavos,meio)
    values(p_pedido,p_caixa,c.empresa_id,p_total,meio);
  insert into public.itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos,pesagem)
    select p_pedido,i.produto_id,i.nome,i.quantidade,i.preco_centavos,i.pesagem
      from jsonb_to_recordset(p.itens) i(produto_id uuid,nome text,quantidade integer,preco_centavos bigint,pesagem jsonb);
  insert into public.movimentos_caixa(empresa_id,caixa_id,tipo,valor_centavos,meio)
    values(c.empresa_id,p_caixa,'venda',p_total,meio);
  update remo.acertos_entrega set confirmado_em=now(),caixa_id=p_caixa,confirmado_por=auth.uid(),
    maquininha_devolvida=coalesce(p_maquininha_devolvida,false) where pedido_id=p_pedido;
  return p_total;
end;
$$;

create or replace function public.receber_comanda_conferida(p_caixa uuid,p_pedido uuid,p_meio text,p_total bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare c public.caixas; valor bigint;
begin
  c:=public.caixa_do_operador(p_caixa);
  select total_centavos into valor from public.pedidos_online
    where id=p_pedido and empresa_id=c.empresa_id for update;
  if not found or valor is distinct from p_total then
    raise exception 'O total da comanda mudou. Confira o novo valor antes de receber.';
  end if;
  if exists(select 1 from public.entregas_pedido where pedido_id=p_pedido and pagamento='na_entrega') then
    raise exception 'Recebimento na entrega exige conferência do acerto com o entregador.';
  end if;
  return public.receber_pedido_no_caixa(p_caixa,p_pedido,p_meio);
end;
$$;

revoke execute on function public.registrar_acerto_entrega(uuid,uuid,text,bigint,text,jsonb,timestamptz),
  public.acertos_entrega_pendentes(uuid),
  public.confirmar_acerto_entrega(uuid,uuid,text,bigint,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.registrar_acerto_entrega(uuid,uuid,text,bigint,text,jsonb,timestamptz) to service_role;
grant execute on function public.acertos_entrega_pendentes(uuid),
  public.confirmar_acerto_entrega(uuid,uuid,text,bigint,text,boolean) to authenticated;
revoke execute on function public.receber_pedido_no_caixa(uuid,uuid,text) from authenticated;

commit;
