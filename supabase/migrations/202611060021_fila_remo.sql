begin;

create schema remo;
revoke all on schema remo from public, anon, authenticated;

create table remo.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('r_sistemas', 'externa')),
  ambiente text not null check (ambiente in ('sandbox', 'producao')),
  referencia text not null,
  solicitante uuid not null,
  destino jsonb not null check (jsonb_typeof(destino) = 'object'),
  cobrar_na_entrega_centavos bigint not null check (cobrar_na_entrega_centavos >= 0),
  estado text not null default 'solicitada' check (estado in ('solicitada', 'aceita', 'em_rota', 'entregue', 'cancelada')),
  criada_em timestamptz not null default now(),
  unique (origem, solicitante, referencia)
);

alter table remo.solicitacoes enable row level security;
revoke all on remo.solicitacoes from public, anon, authenticated;

create function public.solicitar_despacho_remo(p_pedido uuid)
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

revoke execute on function public.solicitar_despacho_remo(uuid) from public, anon, authenticated;
grant execute on function public.solicitar_despacho_remo(uuid) to authenticated;

create table remo.operadores (usuario_id uuid primary key references auth.users(id));
alter table remo.operadores enable row level security;

create function public.fila_remo()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from remo.operadores where usuario_id = auth.uid()) then
    raise exception 'Acesso à central REMO indisponível.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.criada_em) from (
    select id, origem, ambiente, destino, cobrar_na_entrega_centavos, estado, criada_em
    from remo.solicitacoes where estado in ('solicitada','aceita','em_rota')
    order by criada_em limit 100
  ) s), '[]'::jsonb);
end;
$$;

revoke execute on function public.fila_remo() from public, anon, authenticated;
grant execute on function public.fila_remo() to authenticated;

insert into remo.operadores(usuario_id)
select id from auth.users where lower(email) = 'rafaelcaixeta.adm@gmail.com';

commit;
