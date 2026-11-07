-- Execute com conexão privilegiada. Todos os registros do teste são revertidos.
begin;
do $$
declare
  gestor uuid:=gen_random_uuid(); operador uuid:=gen_random_uuid(); kds uuid:=gen_random_uuid();
  loja uuid:=gen_random_uuid(); outra uuid:=gen_random_uuid(); produto uuid:=gen_random_uuid();
  pedido uuid:=gen_random_uuid(); novo uuid:=gen_random_uuid(); pago uuid:=gen_random_uuid();
  lote uuid:=gen_random_uuid(); negado uuid:=gen_random_uuid(); cancelado uuid:=gen_random_uuid();
  terminal uuid:=gen_random_uuid(); caixa uuid; itens jsonb; resultado text; numero bigint;
  bloqueado boolean;
begin
  insert into auth.users(id,email) values (gestor,'gestor-cancelamento@example.invalid'),
    (operador,'operador-cancelamento@example.invalid'),(kds,'kds-cancelamento@example.invalid');
  insert into public.empresas(id,nome,cardapio_slug) values (loja,'Loja de teste','cancelamento-teste'),(outra,'Outra loja',null);
  insert into public.membros(empresa_id,usuario_id,papel) values (loja,gestor,'gestor'),(loja,operador,'operador');
  insert into public.equipe_kds(empresa_id,usuario_id) values (loja,kds);
  insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos) values(produto,loja,'T1','Lanche',1000);
  insert into public.terminais_pdv(id,empresa_id,nome,operador_id) values(terminal,loja,'Caixa teste',operador);
  itens:=jsonb_build_array(jsonb_build_object('produto_id',produto,'nome','Lanche','quantidade',1,'preco_centavos',1000));
  insert into public.pedidos_online(id,empresa_id,cliente,mesa,itens,total_centavos,estado)
    values(pedido,loja,'Em preparo',1,itens,1000,'novo'),(novo,loja,'Novo',2,itens,1000,'novo'),
      (pago,loja,'Pago',3,itens,1000,'entregue');
  insert into public.adicionais_comanda(id,pedido_id,usuario_id,solicitado,itens,estado)
    values(lote,pedido,operador,itens,itens,'novo');
  select p.comanda into numero from public.pedidos_online p where id=pedido;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',operador::text,true);
  caixa:=public.abrir_caixa(loja,0,terminal);
  perform public.receber_comanda_conferida(caixa,pago,'dinheiro',1000);
  bloqueado:=false;
  begin perform public.solicitar_cancelamento_comanda(loja,pago,gen_random_uuid(),'Pagamento confirmado');
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Comanda paga foi cancelada'; end if;
  resultado:=public.solicitar_cancelamento_comanda(loja,novo,gen_random_uuid(),'Cliente desistiu');
  if resultado<>'cancelado' then raise exception 'Pedido novo não foi cancelado'; end if;

  perform set_config('request.jwt.claim.sub',kds::text,true);
  perform public.avancar_pedido(pedido,'preparo');
  begin
    perform public.solicitar_cancelamento_comanda(loja,pedido,gen_random_uuid(),'Sem acesso ao caixa');
    raise exception 'KDS cancelou pelo caixa';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',operador::text,true);
  resultado:=public.solicitar_cancelamento_comanda(loja,pedido,negado,'Motivo da primeira solicitação');
  if resultado<>'pendente' then raise exception 'Operador cancelou após início do preparo'; end if;
  begin
    perform public.resolver_cancelamento_comanda(loja,negado,true,null);
    raise exception 'Operador aprovou o próprio cancelamento';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',kds::text,true);
  if not exists(select 1 from jsonb_array_elements(public.fila_cozinha(loja)) f
    where f->>'id'=pedido::text and (f->>'cancelamento_pendente')::boolean) then raise exception 'KDS não sinalizou a pausa'; end if;
  bloqueado:=false;
  begin perform public.avancar_adicional_comanda(lote,'preparo'); exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Adicional avançou durante a pausa'; end if;

  perform set_config('request.jwt.claim.sub',gestor::text,true);
  perform public.resolver_cancelamento_comanda(loja,negado,false,'Cliente confirmou o pedido');
  perform set_config('request.jwt.claim.sub',kds::text,true);
  perform public.avancar_adicional_comanda(lote,'preparo');
  perform set_config('request.jwt.claim.sub',operador::text,true);
  resultado:=public.solicitar_cancelamento_comanda(loja,pedido,cancelado,'Cliente desistiu do pedido');
  if resultado<>'pendente' then raise exception 'Solicitação ausente'; end if;
  perform set_config('request.jwt.claim.sub',gestor::text,true);
  perform public.resolver_cancelamento_comanda(loja,cancelado,true,null);
  if not exists(select 1 from jsonb_array_elements(public.comandas_para_cancelar(loja,numero::text)->'historico') h
    where h->>'estado'='cancelado' and h->>'motivo'='Cliente desistiu do pedido'
      and h->>'solicitado_por'='operador-cancelamento@example.invalid'
      and h->>'resolvido_por'='gestor-cancelamento@example.invalid') then raise exception 'Histórico do cancelamento incompleto'; end if;
  if exists(select 1 from jsonb_array_elements(public.comandas_pendentes(loja,'')) c where c->>'id'=pedido::text)
    then raise exception 'Comanda cancelada voltou para cobrança'; end if;

  perform set_config('request.jwt.claim.sub',kds::text,true);
  if exists(select 1 from jsonb_array_elements(public.fila_cozinha(loja)) f where f->>'id' in (pedido::text,lote::text))
    then raise exception 'Comanda cancelada continuou na fila ativa'; end if;
  if not exists(select 1 from jsonb_array_elements(public.cancelamentos_recentes_kds(loja)) c where (c->>'comanda')::bigint=numero)
    or public.cancelamentos_recentes_kds(outra)<>'[]'::jsonb then raise exception 'Aviso ao KDS incorreto'; end if;
  if public.acompanhar_pedido('cancelamento-teste',pedido)->>'cancelado'<>'true' then
    raise exception 'Acompanhamento público não sinalizou cancelamento';
  end if;
  perform set_config('request.jwt.claim.sub',operador::text,true);
  bloqueado:=false;
  begin perform public.receber_comanda_conferida(caixa,pedido,'dinheiro',1000);
  exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Comanda cancelada foi recebida'; end if;
  reset role;
  if (select estado from public.adicionais_comanda where id=lote)<>'cancelado' then raise exception 'Lote não cancelado'; end if;
end;
$$;
select 'OK autorização, negativa, cancelamento, KDS, histórico e proteção de cobrança' as validacao;
rollback;
