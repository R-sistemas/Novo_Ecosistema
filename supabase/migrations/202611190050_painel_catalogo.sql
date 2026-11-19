begin;

create function public.painel_listar_produtos(p_empresa_id uuid, p_cursor uuid, p_limite integer)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if p_empresa_id is null then raise insufficient_privilege; end if;
  perform public.painel_contexto_sessao(p_empresa_id);
  if p_limite is null or p_limite not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Limite inválido';
  end if;
  with candidatos as (
    select p.id, p.empresa_id, p.codigo, p.nome, p.preco_centavos, p.ativo, p.categoria,
      p.descricao, p.composicao, p.visivel_cardapio, p.preparo_cozinha, p.queridinho, p.vendido_por_peso,
      row_number() over (order by p.id) as linha
    from public.produtos p
    where p.empresa_id = p_empresa_id and (p_cursor is null or p.id > p_cursor)
    order by p.id limit p_limite + 1
  )
  select jsonb_build_object(
    'produtos', coalesce(jsonb_agg(to_jsonb(c) - 'linha' order by c.id)
      filter (where c.linha <= p_limite), '[]'::jsonb),
    'proximo_cursor', case when count(*) > p_limite then
      max(c.id::text) filter (where c.linha = p_limite) end
  ) into v_resultado from candidatos c;
  return v_resultado;
end;
$$;

create function public.painel_gravar_produto(p_empresa_id uuid, p_produto_id uuid, p_dados jsonb)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_produto public.produtos;
  v_id uuid;
  v_campos constant text[] := array['codigo','nome','preco_centavos','ativo','categoria','descricao',
    'composicao','foto_cardapio','visivel_cardapio','preparo_cozinha','queridinho','vendido_por_peso'];
begin
  if p_empresa_id is null then raise insufficient_privilege; end if;
  perform public.painel_contexto_sessao(p_empresa_id);
  if jsonb_typeof(p_dados) is distinct from 'object' or p_dados = '{}'::jsonb or p_dados - v_campos <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Campos do produto inválidos';
  end if;

  if p_produto_id is null then
    v_produto := jsonb_populate_record(null::public.produtos, jsonb_build_object(
      'ativo', true, 'visivel_cardapio', true, 'preparo_cozinha', true,
      'queridinho', false, 'vendido_por_peso', false
    ) || p_dados);
    insert into public.produtos (empresa_id, codigo, nome, preco_centavos, ativo, categoria, descricao,
      composicao, foto_cardapio, visivel_cardapio, preparo_cozinha, queridinho, vendido_por_peso)
    values (p_empresa_id, v_produto.codigo, v_produto.nome, v_produto.preco_centavos, v_produto.ativo,
      v_produto.categoria, v_produto.descricao, v_produto.composicao, v_produto.foto_cardapio,
      v_produto.visivel_cardapio, v_produto.preparo_cozinha, v_produto.queridinho, v_produto.vendido_por_peso)
    returning id into v_id;
  else
    select p.* into v_produto from public.produtos p
      where p.empresa_id = p_empresa_id and p.id = p_produto_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Produto indisponível'; end if;
    v_produto := jsonb_populate_record(v_produto, p_dados);
    update public.produtos p set
      codigo = v_produto.codigo, nome = v_produto.nome, preco_centavos = v_produto.preco_centavos,
      ativo = v_produto.ativo, categoria = v_produto.categoria, descricao = v_produto.descricao,
      composicao = v_produto.composicao, foto_cardapio = v_produto.foto_cardapio,
      visivel_cardapio = v_produto.visivel_cardapio, preparo_cozinha = v_produto.preparo_cozinha,
      queridinho = v_produto.queridinho, vendido_por_peso = v_produto.vendido_por_peso
    where p.empresa_id = p_empresa_id and p.id = p_produto_id returning id into v_id;
    if not found then raise insufficient_privilege; end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.painel_listar_produtos(uuid,uuid,integer), public.painel_gravar_produto(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.painel_listar_produtos(uuid,uuid,integer), public.painel_gravar_produto(uuid,uuid,jsonb)
  to authenticated;

commit;
