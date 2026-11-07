-- Execute com conexão privilegiada. Os dados de teste são revertidos.
begin;
do $teste$
declare
 g uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); v uuid:=gen_random_uuid();
 e uuid:=gen_random_uuid(); outra uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); c uuid;
 lanche uuid:=gen_random_uuid(); bebida uuid:=gen_random_uuid(); pedido_mesa uuid:=gen_random_uuid();
 remoto uuid:=gen_random_uuid(); pago uuid:=gen_random_uuid(); ultimo uuid:=gen_random_uuid();
 pedido_itens jsonb; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); x uuid;
 fila jsonb; lista jsonb; numero bigint; resultado text; bloqueado boolean;
begin
 insert into auth.users(id,email) values(g,'gestor-kds-fixture@example.invalid'),(k,'cozinha-kds-fixture@example.invalid'),(v,'vendas-kds-fixture@example.invalid');
 insert into public.empresas(id,nome) values(e,'Loja de teste'),(outra,'Outra loja');
 insert into public.membros(empresa_id,usuario_id,papel) values(e,g,'gestor'),(e,v,'operador');
 insert into public.equipe_kds(empresa_id,usuario_id) values(e,k),(outra,k);
 insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos,preparo_cozinha)
 values(lanche,e,'1','Lanche',500,true),(bebida,e,'2','Bebida',200,false);
 pedido_itens:=jsonb_build_array(jsonb_build_object('produto_id',lanche,'nome','Lanche','quantidade',2,'preco_centavos',500));
 insert into public.pedidos_online(id,empresa_id,cliente,mesa,itens,total_centavos,estado)
 values(pedido_mesa,e,'Mesa',1,pedido_itens,1000,'novo'),(remoto,e,'Retirada',null,pedido_itens,1000,'novo'),
   (pago,e,'Pago',null,pedido_itens,1000,'novo'),(ultimo,e,'Último',2,pedido_itens,1000,'novo');
 insert into public.provedores_pagamento(empresa_id,provedor,ambiente,pix_habilitado) values(e,'mercado_pago','sandbox',true);
 insert into public.pagamentos_online(pedido_id,empresa_id,provedor,ambiente,meio,valor_centavos,cobranca_id,confirmado_em)
 values(pago,e,'mercado_pago','sandbox','pix',1000,'fixture-' || pago,now());
 select comanda into numero from public.pedidos_online where id=pedido_mesa;
 perform set_config('request.jwt.claim.sub',k::text,true);
 if public.pode_editar_comanda_kds(e) or public.consultar_comanda_kds(e,numero) is not null then raise exception 'Permissão inicial indevida'; end if;
 begin
   perform public.registrar_ajuste_kds(e,pedido_mesa,gen_random_uuid(),'adicionar',bebida,1,'Teste');
   raise exception 'Acesso indevido à edição';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',g::text,true);
 perform public.configurar_edicao_kds(e,'cozinha-kds-fixture@example.invalid',true);
 insert into public.terminais_pdv(id,empresa_id,nome,operador_id) values(t,e,'Caixa',g);
 c:=public.abrir_caixa(e,0,t);
 perform set_config('request.jwt.claim.sub',k::text,true);
 if public.consultar_comanda_kds(outra,numero) is not null then raise exception 'Leitura fora da loja'; end if;
 if (public.consultar_comanda_kds(e,numero)->'itens'->0) ? 'preco_centavos' then raise exception 'Preço exposto à cozinha'; end if;
 resultado:=public.registrar_ajuste_kds(e,pedido_mesa,a,'adicionar',lanche,1,'Cliente pediu mais');
 if resultado<>'aplicado' then raise exception 'Adicional não aplicado'; end if;
 perform public.registrar_ajuste_kds(e,pedido_mesa,a,'adicionar',lanche,1,'Cliente pediu mais');
 perform public.registrar_ajuste_kds(e,pedido_mesa,b,'adicionar',bebida,1,'Cliente pediu bebida');
 fila:=public.fila_cozinha(e);
 if not exists(select 1 from jsonb_array_elements(fila) f where f->>'id'=pedido_mesa::text and (f->'itens'->0->>'quantidade')::int=2)
   or not exists(select 1 from jsonb_array_elements(fila) f where f->>'id'=a::text and (f->'itens'->0->>'quantidade')::int=1)
   or exists(select 1 from jsonb_array_elements(fila) f where f->>'id'=b::text)
   then raise exception 'Separação de itens originais e adicionais incorreta'; end if;
 if (select total_centavos from public.pedidos_online where id=pedido_mesa)<>1700 then raise exception 'Total ou repetição incorretos'; end if;
 perform public.avancar_pedido(pedido_mesa,'preparo');
 resultado:=public.registrar_ajuste_kds(e,pedido_mesa,gen_random_uuid(),'retirar',bebida,1,'Cliente desistiu');
 if resultado<>'aplicado' then raise exception 'Bebida sem preparo deveria sair diretamente'; end if;
 x:=gen_random_uuid();
 resultado:=public.registrar_ajuste_kds(e,pedido_mesa,x,'retirar',lanche,2,'Ingrediente acabou');
 if resultado<>'pendente' then raise exception 'Item em preparo retirado sem gestor'; end if;
 bloqueado:=false;
 begin perform public.avancar_pedido(pedido_mesa,'pronto'); exception when others then bloqueado:=true; end;
 if not bloqueado then raise exception 'Andamento permitido durante ajuste'; end if;
 perform set_config('request.jwt.claim.sub',v::text,true);
 lista:=public.ajustes_pendentes_caixa(e);
 if jsonb_array_length(lista)<>1 then raise exception 'Solicitação ausente no caixa'; end if;
 begin
   perform public.resolver_ajuste_comanda(x,true,'Cliente confirmou');
   raise exception 'Caixa retirou item em preparo sem gestor';
 exception when sqlstate 'P2001' then null; end;
 perform set_config('request.jwt.claim.sub',g::text,true);
 perform public.resolver_ajuste_comanda(x,true,'Retirada autorizada pelo gestor');
 if (select total_centavos from public.pedidos_online where id=pedido_mesa)<>500 then raise exception 'Total após retirada incorreto'; end if;
 perform public.avancar_pedido(pedido_mesa,'pronto');
 perform public.avancar_pedido(pedido_mesa,'entregue');
 bloqueado:=false;
 begin perform public.receber_comanda_conferida(c,pedido_mesa,'dinheiro',1500); exception when others then bloqueado:=true; end;
 if not bloqueado then raise exception 'Valor desatualizado recebido'; end if;
 if public.receber_comanda_conferida(c,pedido_mesa,'dinheiro',500)<>500 then raise exception 'Recebimento incorreto'; end if;
 perform set_config('request.jwt.claim.sub',k::text,true);
 x:=gen_random_uuid();
 resultado:=public.registrar_ajuste_kds(e,remoto,x,'retirar',lanche,1,'Ingrediente acabou');
 if resultado<>'pendente' or (select total_centavos from public.pedidos_online where id=remoto)<>1000 then raise exception 'Remoto alterado direto'; end if;
 perform set_config('request.jwt.claim.sub',v::text,true);
 perform public.resolver_ajuste_comanda(x,true,'Cliente concordou');
 if (select total_centavos from public.pedidos_online where id=remoto)<>500 then raise exception 'Ajuste remoto não aplicado'; end if;
 perform set_config('request.jwt.claim.sub',k::text,true);
 x:=gen_random_uuid();
 resultado:=public.registrar_ajuste_kds(e,remoto,x,'adicionar',lanche,1,'Cliente pediu mais');
 if resultado<>'pendente' then raise exception 'Adicional remoto aplicado sem confirmação'; end if;
 perform set_config('request.jwt.claim.sub',v::text,true);
 perform public.resolver_ajuste_comanda(x,true,'Cliente concordou');
 perform set_config('request.jwt.claim.sub',g::text,true);
 bloqueado:=false;
 begin perform public.receber_comanda_conferida(c,remoto,'dinheiro',1000); exception when others then bloqueado:=true; end;
 if not bloqueado then raise exception 'Adicional remoto recebido antes do preparo'; end if;
 perform public.avancar_adicional_comanda(x,'preparo');
 perform public.avancar_adicional_comanda(x,'pronto');
 if public.receber_comanda_conferida(c,remoto,'dinheiro',1000)<>1000 then raise exception 'Recebimento remoto incorreto'; end if;
 perform public.avancar_adicional_comanda(x,'entregue');
 perform set_config('request.jwt.claim.sub',k::text,true);
 x:=gen_random_uuid();
 resultado:=public.registrar_ajuste_kds(e,pago,x,'retirar',lanche,1,'Ingrediente acabou');
 if resultado<>'pendente' then raise exception 'Pedido pago alterado direto'; end if;
 perform set_config('request.jwt.claim.sub',v::text,true);
 bloqueado:=false;
 begin perform public.resolver_ajuste_comanda(x,true,'Cliente concordou'); exception when others then bloqueado:=true; end;
 if not bloqueado then raise exception 'Pedido pago alterado no caixa'; end if;
 perform public.resolver_ajuste_comanda(x,false,'Resolvido com o cliente');
 if (select total_centavos from public.pedidos_online where id=pago)<>1000 then raise exception 'Cobrança perdeu o total original'; end if;
 perform set_config('request.jwt.claim.sub',k::text,true);
 resultado:=public.registrar_ajuste_kds(e,ultimo,gen_random_uuid(),'retirar',lanche,2,'Cliente desistiu');
 if resultado<>'aplicado' or not exists(select 1 from public.pedidos_online where id=ultimo and estado='recusado' and total_centavos=0)
   then raise exception 'Cancelamento do último item falhou'; end if;
 perform set_config('request.jwt.claim.sub',g::text,true);
 perform public.configurar_edicao_kds(e,'cozinha-kds-fixture@example.invalid',false);
 perform set_config('request.jwt.claim.sub',k::text,true);
 if public.pode_editar_comanda_kds(e) then raise exception 'Revogação falhou'; end if;
end;
$teste$;
select 'OK permissões, adicionais, retirada, gestor, caixa, pedido pago e recebimento' as validacao;
rollback;
