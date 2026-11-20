# Aprovação da Visão geral da loja

A aba Visão geral agrega pedidos, recebimentos e pendências com uma chamada à RPC `painel_visao_geral(uuid,date,date)`. O período usa dias de São Paulo, com início inclusivo, fim exclusivo e limite de 366 dias. Na tela, a data final personalizada é inclusiva. A série traz uma linha por dia, inclusive quando o banco retorna zero. Falhas exibem uma mensagem de erro e ocultam os indicadores da consulta anterior.

## Critérios dos indicadores

- Pedidos usam a data de criação. O estado entregue da REMO prevalece sobre o KDS. O cancelamento confirmado aparece na linha de cancelados, separado dos demais estados. O total de pedidos inclui cancelados. Pedidos identificados como sandbox ficam fora da Visão geral. O Monitor mantém seu contrato, que permite identificar testes.
- A receita confirmada é a soma de vendas do caixa e pagamentos online confirmados em produção, na data do recebimento. Uma venda coberta por pagamento online confirmado fica fora da soma do caixa. Pendentes online aparecem como contagem separada e cancelados não entram nessa contagem.
- Pix, crédito, débito e pagamento na entrega têm linhas próprias. Dinheiro e cartão genérico do caixa também aparecem em linhas próprias para os canais fecharem com a receita total. O caixa legado não distingue crédito de débito quando registra apenas cartão. O ticket médio divide a receita confirmada pelo número de recebimentos confirmados. Sem recebimentos, a interface mostra um traço no ticket.
- O atalho de Pedidos abre o período selecionado com limites de São Paulo. O atalho do Catálogo abre a primeira página e ativa o filtro de produtos ativos da página. O filtro é local à página e conserva a paginação existente.

## Banco e autorização

A migration `202611200058` extrai as regras do Monitor para duas views privadas. O Monitor passa a consultá-las com a mesma assinatura, autorização, projeção e limites. A migration `202611200059` acrescenta a RPC de indicadores com acesso a `authenticated`, contexto de loja da sessão e `search_path` vazio. O `SECURITY DEFINER` permite os joins privados entre schemas dentro do escopo autorizado. A aba só consulta dados e não inclui trigger de auditoria.

A consulta em produção confirmou os índices `pedidos_online_empresa`, `pedidos_online_painel_cursor`, `vendas_empresa_data` e `pagamentos_online_empresa_confirmacao`. As migrations reutilizam esses índices. Para comparar o corpo do Monitor do catálogo com a reprodução, a evidência normaliza somente CRLF para LF. Os hashes SHA-256 de arquivos são calculados sobre os blobs Git.

## Verificação para aprovação

A suíte aplica as migrations em PGlite descartável e compara a resposta completa do Monitor antes e depois da extração. Confere os totais da Visão geral contra os recebimentos do Monitor, além de REMO entregue, deduplicação, sandbox, pendentes, cancelados, limite de período e isolamento. O Chrome verifica troca de período, série, zero, erro e atalhos. A homologação de implantação em Supabase e Vercel fica para a janela autorizada.
