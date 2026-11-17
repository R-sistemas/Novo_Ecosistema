# Regras de construção da R Sistemas

Estas regras se aplicam a todo o código deste projeto. O PLANO.md define o escopo e a ordem das entregas.

- Organize o código por responsabilidade e domínio. Mantenha interfaces explícitas entre PDV, catálogo, Cardápio, KDS, REMO e pagamentos. Preserve a independência operacional da REMO e use sua API na integração.
- Separe interface, regras de negócio e acesso a dados ou serviços externos. Mantenha dependências previsíveis e evite dependências circulares.
- Mantenha uma implementação por regra de negócio. Antes de escrever uma função, procure uma equivalente. Compartilhe validações e cálculos quando tiverem o mesmo significado. Evite abstrações prematuras e dependências compartilhadas sem necessidade.
- Centralize cada gravação na operação responsável. Use uma fonte de verdade para cada dado e evite gravar o mesmo fato em tabelas, arquivos ou serviços paralelos. Use transações para alterações que precisam ser confirmadas juntas e idempotência para operações que podem ser repetidas.
- Reaproveite código existente quando preservar o contrato, a segurança e a facilidade de manutenção. Trate o App do Rafa como referência de leitura. Avalie qualquer código legado antes de incorporá-lo ao novo projeto.
- Remova código morto, imports, dependências e caminhos obsoletos quando confirmar que não têm consumidores. Preserve o comportamento de quem já usa o fluxo e verifique as regressões relevantes.
- Aplique autorização e isolamento por empresa no servidor e no banco. Valide entradas nas fronteiras e mantenha segredos fora do repositório e do navegador.
- Faça mudanças pequenas e legíveis. Verifique o fluxo pela entrada que o usuário realmente usa e registre limitações de validação.
