# Aprovação de Mesas e Comandas

A aba Mesas lista as mesas da loja, o estado de cada uma, o número de comandas abertas e a data de criação quando registrada. Gestores podem criar mesas de 1 a 999, desativar mesas livres e reativá-las com o mesmo QR. O formulário reaproveita `configurar_mesa_cardapio`, inclusive a recuperação idempotente de uma mesa existente.

## Contrato do QR e das comandas

O QR usa `cardapio.html?loja=…&mesa=…`, o mesmo formato do PDV. O parâmetro `mesa` no link é um UUID. A RPC pública resolve o UUID dentro da loja e persiste o **número inteiro** em `pedidos_online.mesa`. A contagem usa empresa e número para manter a compatibilidade com os pedidos antigos.

São abertas as comandas em novo, preparo ou pronto sem venda registrada e as entregues ainda pendentes do caixa. As entregues reaproveitam o critério extraído de `comandas_pendentes`: sem venda, sem cobrança online e fora do sandbox. Um pedido ainda em preparo bloqueia a desativação mesmo se entrou por um fluxo de cobrança online. Uma comanda aberta produz HTTP 409. O caixa conserva o contrato e o limite da listagem operacional.

`enviar_pedido` rejeita a abertura de pedido com mesa inativa. As reservas Pix e cartão que recebem mesa passam pela mesma resolução para pedidos novos. Entrega em domicílio usa `NULL` no parâmetro de mesa e continua operante. O bloqueio do QR e a desativação compartilham o lock da linha da mesa no fluxo PostgREST padrão, em READ COMMITTED. Um retry idempotente de pedido existente preserva as validações originais. Nenhum token é regenerado.

## Migrations e segurança

- **060** acrescenta `ativo`, inicialmente verdadeiro para mesas existentes, e a data de criação para novos cadastros. Datas anteriores ficam como não registradas. A resolução pública conserva assinatura e grants.
- **061** compartilha o critério de recebimento e adiciona a RPC `painel_mesas` com contexto de sessão, `search_path` vazio e grant para `authenticated`. O acesso direto à tabela permanece restrito. A lista retorna o token apenas das mesas ativas.
- **062** audita criação, desativação e reativação na mesma transação. A origem distingue usuário, serviço e sistema. Os snapshots incluem só número, estado e data quando aplicável. O token fica fora da trilha. A criação legada do PDV passa pelo mesmo trigger.

O PDV compartilha a função de montagem do link. A arte é feita localmente com [qrcode-generator 2.0.4](https://github.com/kazuhikoarase/qrcode-generator), distribuído em `vendor/` com a licença MIT. A imagem e o número da mesa podem ser impressos pelo diálogo.

## Validação

O PGlite reproduz o histórico, compara os corpos SQL com o catálogo normalizando somente CRLF para LF, confere grants e exercita idempotência, cancelamento da desativação com comanda aberta, reservas, entrega, isolamento e falha de auditoria. O Chrome percorre o fluxo de criação, QR, desativação e reativação com o mesmo link. A aplicação em produção depende de janela autorizada.
