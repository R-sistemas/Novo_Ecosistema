begin;

-- A restrição adicional só afeta contratos por validade. O comportamento legado
-- permanece nas portas de 075. Financeiro e conclusão financeira usam as rotas próprias.
create function public.licenca_operacao_permitida(p_empresa uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(
    select 1 from licenciamento_privado.contratos c
    cross join lateral painel_privado.situacao_empresa(c.empresa_id) s
    where c.empresa_id=p_empresa and c.politica='aniversario' and s.efetivo='bloqueada_total');
$$;

create function public.painel_contexto_operacional(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare contexto jsonb := public.painel_contexto_sessao(p_empresa);
begin
  if p_empresa is not null and not public.licenca_operacao_permitida(p_empresa) then
    raise insufficient_privilege using message='Acesso restrito ao financeiro da licença.';
  end if;
  return contexto;
end;
$$;

-- Mesma assinatura, proprietário e grants das RPCs. As chamadas de identidade,
-- regularização e financeiro continuam com painel_contexto_sessao.
do $$
declare f record; definicao text; nova text; total int:=0;
begin
  for f in
    select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname in ('painel_listar_produtos','painel_gravar_produto',
      'painel_equipe','painel_preferencias','painel_listar_pedidos','painel_detalhe_pedido',
      'painel_visao_geral','painel_mesas','painel_entregas')
  loop
    definicao:=pg_catalog.pg_get_functiondef(f.oid);
    nova:=replace(definicao,'public.painel_contexto_sessao(','public.painel_contexto_operacional(');
    if nova=definicao then raise exception 'Contexto operacional não encontrado em %',f.oid::regprocedure; end if;
    execute nova;
    total:=total+1;
  end loop;
  if total<>9 then raise exception 'Conjunto inesperado de portas de painel: %',total; end if;
end;
$$;

do $$
declare f regprocedure; definicao text; nova text;
begin
  foreach f in array array['public.pode_operar_cozinha(uuid)'::regprocedure,'public.pode_editar_comanda_kds(uuid)'::regprocedure]
  loop
    definicao:=replace(pg_catalog.pg_get_functiondef(f),chr(13),'');
    nova:=regexp_replace(definicao,chr(10)||'begin'||chr(10),chr(10)||'begin'||chr(10)||
      '  if not public.licenca_operacao_permitida(p_empresa) then return false; end if;'||chr(10),'i');
    if nova=definicao then raise exception 'Guarda não inserida em %',f; end if;
    execute nova;
  end loop;
  foreach f in array array['public.monitor_gestor(uuid,date)'::regprocedure,'public.enviar_aviso_pedido(uuid,uuid,text)'::regprocedure,
    'public.painel_iniciar_cadastro_operador(uuid,uuid,text,text)'::regprocedure]
  loop
    definicao:=replace(pg_catalog.pg_get_functiondef(f),chr(13),'');
    nova:=regexp_replace(definicao,chr(10)||'begin'||chr(10),chr(10)||'begin'||chr(10)||
      '  if not public.licenca_operacao_permitida(p_empresa) then raise insufficient_privilege; end if;'||chr(10),'i');
    if nova=definicao then raise exception 'Guarda não inserida em %',f; end if;
    execute nova;
  end loop;
end;
$$;

create function licenciamento_privado.proteger_mutacao_operacional()
returns trigger language plpgsql security definer set search_path='' as $$
declare alvo uuid; dados jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if auth.uid() is not null then
    alvo:=nullif(dados->>'empresa_id','')::uuid;
    if alvo is null then
      select p.empresa_id into alvo from public.pedidos_online p where p.id=(dados->>'pedido_id')::uuid;
    end if;
    if not public.licenca_operacao_permitida(alvo) or (tg_op='UPDATE' and
      not public.licenca_operacao_permitida(nullif(to_jsonb(old)->>'empresa_id','')::uuid)) then
      raise insufficient_privilege using message='Operação suspensa para esta licença.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare tabela text;
begin
  foreach tabela in array array['produtos','mesas_cardapio','terminais_pdv','pedidos_online'] loop
    execute format('create policy licenca_operacional on public.%I as restrictive for select to authenticated
      using(public.licenca_operacao_permitida(empresa_id))',tabela);
  end loop;
  foreach tabela in array array['produtos','mesas_cardapio','terminais_pdv','adicionais_comanda',
    'ajustes_comanda','cancelamentos_comanda'] loop
    execute format('create trigger licenca_mutacao_operacional before insert or update or delete on public.%I
      for each row execute function licenciamento_privado.proteger_mutacao_operacional()',tabela);
  end loop;
  -- Webhooks/retorno de REMO e a baixa de pedidos em andamento preservam a trilha.
  create trigger licenca_alteracao_pedido before update of itens,estado on public.pedidos_online
    for each row when (new.itens is distinct from old.itens or new.estado<>'entregue') execute function licenciamento_privado.proteger_mutacao_operacional();
end;
$$;

revoke all on function public.licenca_operacao_permitida(uuid),public.painel_contexto_operacional(uuid),
  licenciamento_privado.proteger_mutacao_operacional() from public,anon,authenticated,service_role;
grant execute on function public.licenca_operacao_permitida(uuid),public.painel_contexto_operacional(uuid) to authenticated;
commit;
