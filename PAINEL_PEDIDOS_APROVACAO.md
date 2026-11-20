# Aprovação — Pedidos em leitura

Base `b3da65cbbd4881b077530f831b6816037357534b`. A aba Pedidos em `/admin-loja.html` usa a sessão do painel. A leitura passa por `GET /api/painel-pedidos`, via rewrite da Function existente, e pelas RPCs `painel_listar_pedidos` e `painel_detalhe_pedido`.

## Universo e apresentação

- Uma linha por `public.pedidos_online`. Cardápio inclui mesa e retirada. Entrega é identificada por `entregas_pedido`. As vendas avulsas de balcão ficam fora deste incremento porque não têm o contrato de pedido/KDS. A venda com o mesmo ID **e** empresa complementa meio, desconto e total efetivamente registrado. A consulta de produção encontrou 18 pedidos de cardápio (2 com venda vinculada), 5 de entrega e 6 vendas avulsas.
- Mercadoria é o total histórico do pedido descontado do frete registrado, pois o checkout grava o total já com frete. O total apresentado usa o fechamento da venda vinculada quando existe e o total do pedido nos demais casos. O desconto aparece somente quando registrado na venda. Os itens vêm do snapshot de `pedidos_online.itens`, inclusive o valor do lançamento pesado. Preço ausente é indicado no detalhe.
- O cancelamento confirmado em `cancelamentos_comanda` prevalece no filtro de estado do pedido. O estado de cozinha permanece em `estado_kds`. O estado logístico vem da projeção `remo.solicitacoes`, vinculada por origem R Sistemas, empresa e pedido. Entregue no KDS e entregue pela REMO aparecem em campos separados.
- Pagamento confirmado vem de venda vinculada ou confirmação online/Pix sandbox. Cobrança online sem confirmação fica pendente. A modalidade na entrega e a ausência de confirmação ficam distintas. A baixa do caixa permanece no fluxo operacional.
- Busca por cliente, comanda ou UUID na página atual. Datas da UI representam dias no fuso do navegador, com a data final inclusiva na interface. A RPC recebe instantes no intervalo semiaberto `[início, fim)`. Filtros de período, estado e origem podem ser combinados.
- Cursor por `(criado_em, id)` decrescente com comparação estrita e UUID de desempate. O cursor leva o timestamp original, sem conversão no navegador, e o ID da última linha. Limite padrão 25, válido de 1 a 50. A consulta lê até um registro extra para detectar a próxima página. Mudanças concorrentes nos dados ou filtros podem alterar a composição das páginas.

## Controle de acesso

As RPCs `STABLE SECURITY DEFINER` consultam fontes com RLS e grants distintos. O acesso direto a endereço e à projeção REMO é restrito. As funções usam `search_path` vazio, grant apenas a `authenticated` e o contexto de sessão para resolver o escopo de loja. A consulta de detalhe retorna o mesmo 404 para ID ausente ou de outra loja quando o gestor solicita sob sua própria empresa. O acesso direto pela empresa alheia é negado com 403.

A listagem projeta somente os campos necessários para a tabela. Endereço e telefone são retornados por uma lista explícita de campos no detalhe autorizado. O endereço não é escrito no DOM da lista e o detalhe é limpo ao fechar. A arquitetura §3.3 exige trilha para mutações administrativas. Esta leitura não escreve na trilha nem persiste o conteúdo consultado em log.

## Validação e corte

- `node --test tests/painel-pedidos.mjs` aplica as migrations num PGlite descartável. A prova HTTP usa a Function e o rewrite, com o Supabase simulado sobre as RPCs do banco local. Com as variáveis `PAINEL_PLAYWRIGHT_MODULE` e `PAINEL_CHROME_PATH`, o teste também abre a página em Chrome e percorre login, filtros, busca, páginas e detalhe.
- A migration `202611190057_painel_pedidos_leitura.sql` é proposta para aprovação. Acrescenta o índice de paginação, uma visão privada e duas RPCs sem escrita. O ledger de produção permanece em 63.
- CSV, vendas avulsas, visão geral e linha do tempo completa ficaram fora. A integração nesta entrega usa a projeção local de REMO.
