begin;

alter table painel_privado.auditoria
  add column origem_autor text not null default 'usuario'
  check (origem_autor in ('usuario', 'servico', 'sistema'));

-- Campos de texto livre e imagem ficam de fora, inclusive quando mudam.
create function painel_privado.snapshot_produto(p public.produtos)
returns jsonb language sql immutable set search_path = ''
as $$
  select case when p.id is not null then jsonb_build_object(
    'empresa_id', p.empresa_id, 'preco_centavos', p.preco_centavos,
    'ativo', p.ativo, 'visivel_cardapio', p.visivel_cardapio,
    'queridinho', p.queridinho, 'preparo_cozinha', p.preparo_cozinha,
    'vendido_por_peso', p.vendido_por_peso
  ) end;
$$;

create function painel_privado.auditar_produto()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_origem text := case
    when v_usuario is not null then 'usuario'
    when auth.role() = 'service_role' or current_setting('role', true) = 'service_role' then 'servico'
    else 'sistema' end;
  -- A tabela legada exige autor_id; o UUID zero representa operação sem usuário.
  v_autor uuid := coalesce(v_usuario, '00000000-0000-0000-0000-000000000000');
  v_requisicao uuid := gen_random_uuid();
  v_produto public.produtos;
begin
  if tg_op = 'TRUNCATE' then
    insert into painel_privado.auditoria
      (autor_id, origem_autor, escopo, empresa_id, acao, entidade, entidade_id, antes, requisicao_id)
    select v_autor, v_origem, 'loja', p.empresa_id, 'produto.excluir', 'produto', p.id::text,
      painel_privado.snapshot_produto(p), v_requisicao
    from public.produtos p;
    return null;
  end if;

  v_produto := case when tg_op = 'DELETE' then old else new end;
  insert into painel_privado.auditoria
    (autor_id, origem_autor, escopo, empresa_id, acao, entidade, entidade_id, antes, depois, requisicao_id)
  values (
    v_autor, v_origem, 'loja', v_produto.empresa_id,
    case tg_op when 'INSERT' then 'produto.criar' when 'UPDATE' then 'produto.editar' else 'produto.excluir' end,
    'produto', v_produto.id::text,
    case when tg_op <> 'INSERT' then painel_privado.snapshot_produto(old) end,
    case when tg_op <> 'DELETE' then painel_privado.snapshot_produto(new) end, v_requisicao
  );
  return null;
end;
$$;

revoke all on function painel_privado.snapshot_produto(public.produtos), painel_privado.auditar_produto()
  from public, anon, authenticated, service_role;
create trigger auditar_produto_linha after insert or update or delete on public.produtos
  for each row execute function painel_privado.auditar_produto();
create trigger auditar_produto_truncate before truncate on public.produtos
  for each statement execute function painel_privado.auditar_produto();

commit;
