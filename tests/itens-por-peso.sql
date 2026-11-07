-- Execute com conexão privilegiada. Os dados de teste são revertidos.
begin;
do $$
declare
  gestor uuid:=gen_random_uuid(); cozinha uuid:=gen_random_uuid(); loja uuid:=gen_random_uuid();
  terminal uuid:=gen_random_uuid(); caixa uuid; pedido uuid:=gen_random_uuid();
  pao uuid:=gen_random_uuid(); lanche uuid:=gen_random_uuid(); fixo uuid:=gen_random_uuid();
  id_pesagem uuid:=gen_random_uuid(); digitado uuid:=gen_random_uuid(); retirado uuid:=gen_random_uuid();
  recebimento bigint; fila jsonb; itens jsonb;
begin
  insert into auth.users(id,email) values (gestor,'gestor-peso@example.invalid'),(cozinha,'cozinha-peso@example.invalid');
  insert into public.empresas(id,nome,cardapio_slug) values (loja,'Loja de teste','loja-peso-teste');
  insert into public.membros values(loja,gestor,'gestor');
  insert into public.equipe_kds(empresa_id,usuario_id,edita_comanda) values(loja,cozinha,true);
  insert into public.terminais_pdv(id,empresa_id,nome,operador_id) values(terminal,loja,'Teste',gestor);
  insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos,vendido_por_peso,visivel_cardapio,preparo_cozinha)
    values(pao,loja,'P1','Pão francês',2000,true,false,false),
      (lanche,loja,'L1','Lanche',1000,false,true,true),(fixo,loja,'B1','Bebida',200,false,true,false);
  insert into public.pedidos_online(id,empresa_id,cliente,mesa,itens,total_centavos)
    values(pedido,loja,'Cliente teste',1,jsonb_build_array(jsonb_build_object(
      'produto_id',lanche,'nome','Lanche','quantidade',1,'preco_centavos',1000)),1000);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',cozinha::text,true);
  perform public.ajustar_item_pesado(loja,pedido,id_pesagem,pao,300,null,null,null,'Peso digitado');
  perform public.ajustar_item_pesado(loja,pedido,id_pesagem,pao,300,null,null,null,'Peso digitado');
  fila:=public.fila_cozinha(loja);
  if jsonb_array_length(fila)<>1 or jsonb_array_length(fila->0->'itens')<>1 then
    raise exception 'Produto por peso entrou na fila de preparo';
  end if;
  perform public.avancar_pedido(pedido,'preparo');
  perform public.avancar_pedido(pedido,'pronto');
  perform public.avancar_pedido(pedido,'entregue');

  perform set_config('request.jwt.claim.sub',gestor::text,true);
  caixa:=public.abrir_caixa(loja,0,terminal);
  perform public.ajustar_item_pesado(loja,pedido,digitado,pao,null,750,null,caixa,'Valor digitado');
  perform public.ajustar_item_pesado(loja,pedido,retirado,pao,25,null,null,caixa,'Lançamento de teste');
  perform public.ajustar_item_pesado(loja,pedido,gen_random_uuid(),null,null,null,retirado,caixa,'Corrigido no caixa');
  perform public.adicionar_itens_comanda(caixa,pedido,gen_random_uuid(),jsonb_build_array(jsonb_build_object('produto_id',fixo,'quantidade',1)));
  select p.itens into itens from public.pedidos_online p where id=pedido;
  if jsonb_array_length(itens)<>4 or not exists(select 1 from jsonb_array_elements(itens) i
    where i->'pesagem'->>'id'=id_pesagem::text and (i->>'preco_centavos')::integer=600
      and (i->'pesagem'->>'gramas')::integer=300) then raise exception 'Pesagem incorreta após adicionar produto fixo'; end if;
  if (select total_centavos from public.pedidos_online where id=pedido)<>2550 then
    raise exception 'Total da pedido incorreto';
  end if;
  recebimento:=public.receber_comanda_conferida(caixa,pedido,'dinheiro',2550);
  if recebimento<>2550 then raise exception 'Recebimento incorreto'; end if;
  if (select count(*) from public.itens_venda where venda_id=pedido and produto_id=pao and pesagem is not null)<>2
    or not exists(select 1 from public.itens_venda where venda_id=pedido and pesagem->>'id'=digitado::text
      and pesagem->>'modo'='valor' and preco_centavos=750) then raise exception 'Lançamentos não preservados na venda'; end if;
  reset role;
end;
$$;
select 'OK peso, valor digitado, correção, repetição, adicionais fixos e recebimento' as validacao;
rollback;
