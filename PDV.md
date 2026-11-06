# Primeira etapa do PDV

O protótipo local continua usando dados fictícios no navegador. A primeira migração define empresas, vínculos com usuários autenticados, catálogo, sessões e movimentos de caixa.

## Como continuar

1. Revisar a migração em ambiente de teste antes de aplicá-la ao projeto de produção.
2. Criar duas empresas de teste e usuários distintos em Auth. Provisionar os vínculos administrativamente.
3. Verificar leitura, edição do catálogo e isolamento com os tokens de cada usuário.
4. Implementar operações transacionais de abertura, venda, suprimento, sangria e fechamento antes de conectar a tela ao banco. A migração inicial restringe essas gravações até que as operações estejam prontas.
5. Integrar a tela ao Supabase e validar o fluxo de um turno. O histórico de venda precisa conter itens e preços praticados além do movimento de caixa.

## Referências de interface

- PDV do DoRafa. Preservar entrada rápida por código, lista de itens, total e ações por teclado. Adaptar a disposição para celular.
- Cardápio do DoRafa. Preservar navegação por categorias e carrinho, com identidade do estabelecimento.
- REMO. Preservar portal da empresa, despacho e área do entregador como superfícies distintas da mesma central.
