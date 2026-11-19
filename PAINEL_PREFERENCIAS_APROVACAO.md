# Aprovação · Preferências e configurações da loja

Base `6f722848701b3393e21837bcbfc036ffb9e0d577`. Entrega em `codex/painel-preferencias`.

## Escopo e escolhas

- A aba **Preferências** usa a autenticação e a seleção de loja de `/admin-loja.html`. Cor principal, os quatro fundos permitidos, logo e arte de agradecimento usam o tema e os presets de conversão WebP compartilhados com o PDV. A prévia aplica o rascunho aos dados de `ver_cardapio` e mostra nome e uma amostra dos produtos efetivamente publicados. O rascunho permanece local até salvar. Após salvar, a prévia consulta novamente a vitrine.
- O gestor informa latitude e longitude em graus decimais, com até seis casas armazenadas. Os campos são um par. Limpar ambos volta ao centro padrão que o checkout já usa. Não há geocodificação nem dependência externa nova.
- Pagamento na entrega reusa `configurar_pagamento_na_entrega`. Pix, crédito e débito aparecem somente como indicadores de disponibilidade no checkout público. A definição efetiva de `metodos_checkout_publico(text)` retorna os três booleanos, com débito sempre falso. Credenciais e configuração de provedores ficam fora da aba.
- Mesas ficam para outro incremento. `configurar_mesa_cardapio` é um upsert por número que entrega o token do QR, e o contrato atual não inclui inventário, revogação ou apresentação segura desse token. A entrega de aparência, mapa e pagamento cabe no mesmo incremento porque a operação acrescenta um único booleano reutilizado.

## Banco e segurança

| Migration | Responsabilidade |
| --- | --- |
| `202611190055` | Instala um trigger `AFTER UPDATE` em empresas com comparação dos sete campos de preferência. Abrange escritas do PDV, da Function e de serviço, inclusive mudanças produzidas por outros caminhos de UPDATE. O trigger de nome do PDV continua separado. |
| `202611190056` | Cria a RPC `painel_preferencias(uuid,jsonb)`. O gateway verifica a loja com `painel_contexto_sessao`, limita o patch por campo, preserva o que foi omitido e reusa as RPCs legadas de aparência e pagamento. O `SECURITY DEFINER` é necessário para o centro do mapa e para o lock que serializa a leitura e a escrita. O grant de aplicação é somente para `authenticated` e o `search_path` é fixo. |

O endpoint usa a Function existente por rewrite, valida formatos antes de gravar e usa a empresa retornada pelo contexto da sessão. A RPC verifica a autorização novamente e o banco continua aplicando os CHECKs. Atualizações concorrentes de domínios preservam campos omitidos. Uma gravação da aba é transacional, mesmo que toque mais de um domínio. O trigger registra só os campos alterados. Imagens entram como presença, sem data-URI nem conteúdo. A trilha registra `auth.uid()` quando disponível e distingue usuário, serviço e sistema. Se o registro da auditoria falhar, todas as alterações da transação são revertidas.

A consulta prévia ao catálogo foi somente leitura no ref `eyqxxlcmxlilgogxdcoq`, host `eyqxxlcmxlilgogxdcoq.supabase.co`, com ledger 61. A evidência inclui ACL, restrições, trigger de nome do PDV e as definições efetivas das RPCs legadas. Nenhuma migração antiga foi modificada.

## Homologação

A suíte local aplica todo o histórico saneado em PostgreSQL 17 descartável e testa o dispatcher e a RPC. Chrome usa as páginas reais com Auth/PostgREST simulados e respostas do PostgreSQL local para preferências e vitrine. O teste converte um PNG em WebP, confirma o rascunho antes de salvar, abre o Cardápio público e verifica a cor publicada. Os testes de SQL confirmam o toggle consumido pelo checkout, auditoria do fluxo legado, isolamento e falha atômica injetada.

Após autorização para ambiente separado, valide com JWTs reais de dois gestores e um operador. Teste 200 próprio, 403 cruzado e do operador, 401 sem sessão, formatos inválidos, prévia e Cardápio após salvar, o indicador de pagamento na entrega, suas trilhas e a restauração dos valores de teste. Use falha injetada somente em banco descartável. O pacote atual não autoriza publicação nem aplicação em produção.
