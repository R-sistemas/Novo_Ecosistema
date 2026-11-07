-- Execute com conexão privilegiada. Todos os registros do teste são revertidos.
begin;
do $$
declare
  gestor uuid:=gen_random_uuid(); outro uuid:=gen_random_uuid(); loja uuid:=gen_random_uuid();
  terminal uuid:=gen_random_uuid(); outro_terminal uuid:=gen_random_uuid(); caixa uuid; outro_caixa uuid;
  produto uuid:=gen_random_uuid(); pedido uuid:=gen_random_uuid(); tentativa uuid:=gen_random_uuid();
  reserva uuid:=gen_random_uuid(); segunda uuid:=gen_random_uuid(); itens jsonb; dados jsonb; resultado text;
  bloqueado boolean;
begin
  insert into auth.users(id,email) values(gestor,'gestor-pix-pdv@example.invalid'),(outro,'outro-pix-pdv@example.invalid');
  insert into public.empresas(id,nome) values(loja,'Loja Pix teste');
  insert into public.membros values(loja,gestor,'gestor'),(loja,outro,'operador');
  insert into public.provedores_pagamento(empresa_id,provedor,ambiente,pix_habilitado) values(loja,'mercado_pago','sandbox',true);
  insert into public.terminais_pdv(id,empresa_id,nome,operador_id) values(terminal,loja,'Caixa A',gestor),(outro_terminal,loja,'Caixa B',outro);
  insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos) values(produto,loja,'T1','Lanche',1000);
  itens:=jsonb_build_array(jsonb_build_object('produto_id',produto,'quantidade',1));
  insert into public.pedidos_online(id,empresa_id,cliente,mesa,itens,total_centavos,estado)
  values(pedido,loja,'Mesa de teste',1,jsonb_build_array(jsonb_build_object('produto_id',produto,'nome','Lanche',
    'quantidade',1,'preco_centavos',1000)),1000,'entregue');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',gestor::text,true);
  caixa:=public.abrir_caixa(loja,0,terminal);
  if public.pix_frente_disponivel(loja)<>'sandbox' then raise exception 'Ambiente Pix não configurado'; end if;
  bloqueado:=false;
  begin perform public.registrar_venda_com_desconto(caixa,gen_random_uuid(),'pix',itens,0); exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Pix manual indevidamente registrado'; end if;
  dados:=public.reservar_pix_frente(caixa,tentativa,null,itens,50,950,null);
  if dados->>'estado'<>'reservado' or (dados->>'valor_centavos')::int<>950 then raise exception 'Reserva com desconto incorreta'; end if;
  dados:=public.consultar_pix_frente(caixa,null);
  if dados->>'id'<>tentativa::text then raise exception 'Recuperação do Pix em aberto falhou'; end if;
  bloqueado:=false;
  begin perform public.fechar_caixa(caixa,0); exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Caixa fechou com Pix em aberto'; end if;
  reset role;

  set local role service_role;
  resultado:=public.conciliar_pix_frente(tentativa,'ORDTST1',950,'sandbox','aguardando');
  if resultado<>'aguardando' then raise exception 'Ordem pendente não vinculada'; end if;
  bloqueado:=false;
  begin perform public.conciliar_pix_frente(tentativa,'ORDTST1',1000,'sandbox','confirmado'); exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Valor divergente confirmado'; end if;
  perform public.conciliar_pix_frente(tentativa,'ORDTST1',950,'sandbox','confirmado');
  perform public.conciliar_pix_frente(tentativa,'ORDTST1',950,'sandbox','confirmado');
  reset role;
  if (select count(*) from public.movimentos_caixa where caixa_id=caixa and tipo='venda')<>1 then raise exception 'Venda duplicada'; end if;

  set local role authenticated;
  dados:=public.reservar_pix_frente(caixa,reserva,pedido,'[]'::jsonb,0,1000,null);
  perform set_config('request.jwt.claim.sub',outro::text,true);
  outro_caixa:=public.abrir_caixa(loja,0,outro_terminal);
  bloqueado:=false;
  begin perform public.receber_comanda_conferida(outro_caixa,pedido,'dinheiro',1000); exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Outro caixa recebeu comanda em cobrança'; end if;
  bloqueado:=false;
  begin perform public.solicitar_cancelamento_comanda(loja,pedido,gen_random_uuid(),'Teste de bloqueio'); exception when raise_exception then bloqueado:=true; end;
  if not bloqueado then raise exception 'Comanda cancelada durante cobrança'; end if;
  reset role;

  set local role service_role;
  perform public.conciliar_pix_frente(reserva,'ORDTST2',1000,'sandbox','expirado');
  reset role;
  set local role authenticated;
  dados:=public.reservar_pix_frente(outro_caixa,segunda,pedido,'[]'::jsonb,0,1000,null);
  if dados->>'id'<>segunda::text then raise exception 'Nova ordem não abriu após expiração'; end if;
  reset role;
  set local role service_role;
  perform public.conciliar_pix_frente(segunda,'ORDTST3',1000,'sandbox','confirmado');
  reset role;
  if not exists(select 1 from public.vendas where id=pedido and total_centavos=1000 and meio='pix') then
    raise exception 'Recebimento da comanda não foi registrado';
  end if;
end;
$$;
select 'OK Pix balcão e mesa, desconto, bloqueios, expiração, retomada e idempotência' as validacao;
rollback;
