begin;
do $$
<<fixture>>
declare
  loja uuid; produto uuid; mesa uuid; pedido uuid; itens jsonb; resultado jsonb;
  ambiente text; superficie text; slug text; chave text; integracao uuid; endereco jsonb;
  destino jsonb := '{"logradouro":"Rua Teste","numero":"1","bairro":"Centro","cidade":"Goiânia","telefone":"62999999999","metodo_pagamento":"credito"}';
begin
  foreach ambiente in array array['sandbox','producao'] loop
    loja := gen_random_uuid(); produto := gen_random_uuid(); mesa := gen_random_uuid();
    slug := 'credito-fixture-'||ambiente; chave := 'chave-'||ambiente;
    insert into public.empresas(id,nome,cardapio_slug,sandbox_checkout,oferece_entrega)
      values(loja,'Fixture cartão',slug,ambiente='sandbox',ambiente='producao');
    insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos,visivel_cardapio)
      values(produto,loja,'A','Lanche',1000,true);
    insert into public.mesas_cardapio(empresa_id,numero,token) values(loja,1,mesa);
    insert into public.provedores_pagamento(empresa_id,provedor,ambiente,credito_habilitado)
      values(loja,'mercado_pago',ambiente,true);
    insert into painel_privado.credenciais_mp(empresa_id,ambiente,recebedor,envelope,chave_publica,estado,revisao)
      values(loja,ambiente,case ambiente when 'sandbox' then '3095871690' else '12345' end,repeat('X',50),chave,'ativa',1)
      returning id into integracao;
    itens := jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',1));

    set local role anon;
    resultado := public.opcoes_mp_cardapio(slug);
    if (resultado->>'ambiente',resultado->>'chave_publica') is distinct from (ambiente,chave)
      or not coalesce((resultado->>'credito')::boolean,false) then raise exception 'Configuração incorreta'; end if;
    reset role;
    foreach superficie in array array['mesa','balcao','entrega'] loop
      pedido := gen_random_uuid();
      endereco := case when superficie='entrega' then destino end;
      set local role service_role;
      resultado := public.servico_mp_reserva_credito(slug,pedido,'Cliente fixture',
        case when superficie='mesa' then mesa end,itens,ambiente,chave,endereco,case when endereco is not null then 500 end);
      if (resultado->>'integracao',resultado->>'ambiente',(resultado->>'total_centavos')::bigint) is distinct from
        (integracao::text,ambiente,case when endereco is not null then 1500::bigint else 1000::bigint end)
        then raise exception 'Reserva incorreta para %/%', ambiente, superficie; end if;
      perform public.servico_mp_reserva_credito(slug,pedido,'Cliente fixture',
        case when superficie='mesa' then mesa end,itens,ambiente,chave,endereco,case when endereco is not null then 500 end);
      reset role;
      if not exists (select from public.pagamentos_online p where p.pedido_id=pedido and p.empresa_id=loja
        and p.integracao_mp=integracao and p.ambiente=fixture.ambiente) then raise exception 'Vínculo incorreto'; end if;
    end loop;
    pedido := gen_random_uuid();
    set local role service_role;
    begin
      perform public.servico_mp_reserva_credito(slug,pedido,'Cliente fixture',null,itens,
        case ambiente when 'sandbox' then 'producao' else 'sandbox' end,chave);
      raise exception 'Ambiente divergente aceito';
    exception when sqlstate 'PT409' then null; end;
    reset role;
    update painel_privado.credenciais_mp set chave_publica=chave||'-nova' where id=integracao;
    set local role service_role;
    begin
      perform public.servico_mp_reserva_credito(slug,pedido,'Cliente fixture',null,itens,ambiente,chave);
      raise exception 'Configuração antiga aceita';
    exception when sqlstate 'PT409' then null; end;
    reset role;
    if exists (select from public.pedidos_online where id=pedido) then raise exception 'Pedido indevido criado'; end if;
  end loop;
end;
$$;
rollback;
