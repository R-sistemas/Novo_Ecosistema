# Retomada — 17/11/2026

Registro das observações feitas pelo Rafael em 16/11/2026. São relatos de uso em produção; as causas ainda precisam ser verificadas com código, banco, registros e testes entre os sistemas.

## Pedido pago e despacho ausente

- Foi criado o usuário de cozinha K10. No portal da cozinha, a comanda 79 apareceu como **entrega**. O preparo foi iniciado e marcado **pronto**; o pedido continuou visível como pronto.
- Rafael relata que a comanda 79 foi paga. O PDV não indicou que a cozinha finalizou e encaminhou à REMO.
- No monitor do gestor, a comanda 79 constava como recebida, com **entregas em rota: 0** e indicação de despacho pendente.
- A administração da REMO e o portal do cliente não mostraram requisição ou ordem para essa entrega. O saldo da carteira não foi debitado.
- A comanda 78, associada à tentativa que falhou ao gerar Pix, constava no monitor como **novo / aguardando confirmação online**. É preciso separar esse pedido não confirmado do pedido 79 pago ao auditar o fluxo.

## Entregador e distribuição de corridas

- O cadastro administrativo da REMO exigiu selecionar uma empresa para cadastrar o entregador. Rafael cadastrou Bruno e marcou o Quiosque Do'Rafa apenas para testar.
- No portal/PWA do entregador, Bruno não viu corridas disponíveis e a notificação push apareceu como indisponível.
- Regra de negócio a restaurar/verificar: o entregador pertence à operação da REMO, atende empresas parceiras conforme disponibilidade e pode montar sua corrida. A vinculação exclusiva a uma empresa não atende ao fluxo esperado.

## Outros sintomas observados

- Na administração da REMO, **Relatórios** exibiu “erro ao carregar relatórios”.
- A área de notificações push indicou **Web Push / VAPID não configurado** e ausência de chave pública.
- Na compra feita pelo computador, Rafael não viu a animação de confirmação do pagamento Pix que existia antes.

## Auditoria na retomada

1. Rastrear a comanda 79 de ponta a ponta: confirmação Pix, estado do pedido, ação KDS, evento/endpoint de despacho, resposta da REMO, persistência da ordem, saldo e sinais no PDV/monitor. Consultar registros reais antes de concluir a causa.
2. Verificar por que marcar **pronto** não solicitou entrega e qual evento deve disparar o despacho. Validar o comportamento com e sem entregador disponível, sem expor problemas internos ao comprador.
3. Auditar o modelo de cadastro e distribuição dos entregadores e comparar com o fluxo original da REMO antes de alterar regras.
4. Diagnosticar o erro dos relatórios e a configuração efetiva de Web Push/VAPID; validar a PWA do entregador.
5. Comparar as telas Pix no computador e no celular e restaurar a confirmação visual onde estiver ausente.
6. Corrigir, testar o fluxo completo em produção e conferir os reflexos no PDV, KDS, monitor do gestor, administração/portal da REMO e portal do entregador.

Nenhuma causa desses sintomas foi confirmada neste registro. Não usar o pedido 78 como prova de pagamento ou despacho; o pedido 79 é o caso principal relatado para investigação.

## Constatações de 16/11/2026

- No banco da R Sistemas, a comanda 79 está pronta e com Pix confirmado, mas não possui solicitação nem tentativa de despacho. A comanda 78 permanece sem confirmação Pix.
- O botão anterior de despacho estava apenas no PDV. Marcar pronto no KDS não chamava a REMO. Foi publicado o despacho após marcar pronto, com erro visível e ação de repetir no KDS e no PDV. A autorização da equipe KDS foi aplicada no Supabase.
- A REMO publicada anteriormente não reconhecia `r_sistemas_id` na criação de ordem. A versão com esse contrato foi publicada. O vínculo cadastrado para o Quiosque Do'Rafa corresponde ao ID da loja na R Sistemas.
- A carteira do quiosque estava ativa com R$ 53,50 na consulta. Bruno estava ativo e vinculado ao quiosque; sua associação foi removida e o cadastro de entregadores passou a ser global. Não havia inscrição push no aparelho de Bruno.
- As variáveis VAPID estavam ausentes. Um par foi criado na Vercel da REMO, e a chave pública respondeu em produção. A inscrição no aparelho depende de abrir a PWA e permitir notificações.
- As consultas SQL dos relatórios executaram no banco REMO. O aviso antigo era genérico e os registros da Vercel já não cobriam aquele momento. O painel agora mostra o status do erro da API e apresenta dados textuais se o provedor externo de gráficos falhar. A causa exata do aviso antigo não pôde ser comprovada.
- A confirmação visual do Pix foi publicada no cardápio para computador e celular.
- Falta validar com um novo pedido real pago, marcado pronto no KDS, observando ordem, débito, PDV, monitor e entregador. A comanda 79 não foi despachada retroativamente por ser antiga.
