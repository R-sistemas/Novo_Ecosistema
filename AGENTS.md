# Regras de construção da R Sistemas

Estas regras se aplicam a todo o código deste projeto. O PLANO.md define o escopo e a ordem das entregas.

> **Governança de IAs**: antes de editar qualquer coisa, leia `_arquivo_morto/GOVERNANCA_IAs/CONTEXTO_INICIAL_CODEX.md` e `PAPEIS_E_QUADRO_DE_ATRIBUICOES.md` (mesma pasta). Definem papéis (proprietário/executor/auditor), fluxo de aprovação e pacote de evidência obrigatórios.

- Organize o código por responsabilidade e domínio. Mantenha interfaces explícitas entre PDV, catálogo, Cardápio, KDS, REMO e pagamentos. Preserve a independência operacional da REMO e use sua API na integração.
- Separe interface, regras de negócio e acesso a dados ou serviços externos. Mantenha dependências previsíveis e evite dependências circulares.
- Mantenha uma implementação por regra de negócio. Antes de escrever uma função, procure uma equivalente. Compartilhe validações e cálculos quando tiverem o mesmo significado. Evite abstrações prematuras e dependências compartilhadas sem necessidade.
- Centralize cada gravação na operação responsável. Use uma fonte de verdade para cada dado e evite gravar o mesmo fato em tabelas, arquivos ou serviços paralelos. Use transações para alterações que precisam ser confirmadas juntas e idempotência para operações que podem ser repetidas.
- Reaproveite código existente quando preservar o contrato, a segurança e a facilidade de manutenção. Trate o App do Rafa como referência de leitura. Avalie qualquer código legado antes de incorporá-lo ao novo projeto.
- Remova código morto, imports, dependências e caminhos obsoletos quando confirmar que não têm consumidores. Preserve o comportamento de quem já usa o fluxo e verifique as regressões relevantes.
- Aplique autorização e isolamento por empresa no servidor e no banco. Valide entradas nas fronteiras e mantenha segredos fora do repositório e do navegador.
- Faça mudanças pequenas e legíveis. Verifique o fluxo pela entrada que o usuário realmente usa e registre limitações de validação.
## REGRA INVIOLÁVEL — CONFINAMENTO DO PROJETO

Todo artefato do ecossistema — código-fonte, configurações, documentação, migrations, assets, dados de trabalho e qualquer arquivo com valor para o produto — DEVE existir dentro de `C:\Users\RAFAEL_C\Desktop\Ecosistema`. Nenhum código pode ser escrito, nenhum worktree/branch/checkout pode ser criado e nenhum artefato pode ser produzido fora dessa pasta. Sem exceção.

Exceções permitidas (não são artefatos do projeto): caches de ferramentas (`.gradle`, `__pycache__`, `node_modules`), worktrees temporários de agentes que SOMENTE leem o repo, e credenciais de contas (Vercel, Supabase, GitHub, Mercado Pago, Asaas). Todo worktree ou checkout temporário deve ser removido ao final do trabalho — nada pode ficar dependendo de caminho fora de `Desktop\Ecosistema`.

Critério de aceite obrigatório antes de qualquer entrega: executar `git worktree list` nos dois repositórios e confirmar que todo caminho listado está dentro de `Desktop\Ecosistema`; confirmar `git status` limpo e sincronizado com `origin`; e listar qualquer arquivo do projeto referenciado por caminho absoluto externo.

Violação desta regra é motivo de rejeição da entrega.

## Saneamento por módulo — regra obrigatória

Ao concluir um MÓDULO completo em produção (não a cada incremento), é obrigatório executar saneamento: remover worktrees e branches locais de tarefas já mergeadas, confirmar `git worktree list` limpo, `git status` sincronizado e listar o que foi preservado e por quê. O saneamento é local; branches remotas permanecem como histórico. Dúvida sobre o que remover → preservar e reportar. Evidências do saneamento ficam em `_arquivo_morto/painel-evidencia-historico/`.

## Limites de linhas e camadas — regras invioláveis

| Tipo de arquivo | Limite máximo |
| --- | ---: |
| Entry point cliente (`pdv.mjs`, `cardapio.mjs` e equivalentes) | 80 linhas |
| Módulo cliente de interface, regra ou estado | 200 linhas |
| Camada de dados cliente | 300 linhas |
| Biblioteca de servidor (`lib/*.mjs`) | 150 linhas |
| Function HTTP (`api/*`) | 100 linhas |
| HTML | 200 linhas, sem lógica inline |
| CSS por tela | 500 linhas |
| Migration SQL | Sem limite de linhas; uma responsabilidade por arquivo |

1. Nenhum arquivo pode ultrapassar o limite de seu tipo.
2. Cada funcionalidade deve separar `interface/` (DOM, eventos, renderização), `regras/` (cálculos, estados e validações puras) e `dados/` (Supabase e APIs externas). Um arquivo nunca mistura duas camadas.
3. Código novo entra em módulo novo ou existente do domínio, nunca em arquivo que já atingiu o limite.
4. Antes de criar uma função, procurar equivalente existente; reuso tem prioridade sobre duplicação.
5. Código sem consumidor em produção deve ser removido ou movido para `_arquivo_morto/`. Páginas de teste e scripts de homologação não devem ser publicados.
6. Antes de entregar: contar as linhas de todos os arquivos, usar `git grep` para comprovar consumidores de cada módulo e testar o fluxo principal de ponta a ponta.

Ordem de refatoração: começar por `pdv.mjs` e pelos quatro arquivos de teste/protótipo publicados sem consumidor; depois tratar os demais arquivos acima do limite. Preservar o comportamento publicado durante a divisão em módulos.

## Pendência operacional — Deploy automático Vercel

Diagnóstico de 20/11/2026: os projetos Vercel `novo-ecossistema` e `remo` **não possuem conexão Git** (`link: null` na API). Todo deploy é manual via `vercel --prod` (CLI), o que já causou 6+ deploys seguidos manuais nas janelas do painel. Push na `main` nunca dispara build.

Correção autorizada: conectar cada projeto ao seu repositório GitHub — `R-sistemas/Novo_Ecosistema` e `R-sistemas/REMO` — com production branch `main` e previews de branch limitados/desativados. A conta Vercel usa login via GitHub (mesma identidade do repo); a autorização do GitHub App é única e fica permanente.

Critério de aceite: após conectar, um push na `main` deve gerar deployment automático `READY` sem intervenção CLI; verificar que o deploy automático corresponde ao SHA do commit; e confirmar que branches `codex/*` não geram deploys de produção indevidos.

**Decisão do proprietário (economia — sem Vercel Pro por ora):** o projeto `remo` NÃO será conectado ao Git. A Vercel Hobby não conecta repositório privado de organização, e o responsável optou por não pagar Pro neste momento. Portanto: **todo merge na `main` que altere arquivos consumidos pelo projeto REMO exige deploy manual do Codex via `vercel --prod` no diretório do projeto REMO, dentro da mesma janela de deploy** — sem exceção e sem depender de lembrete do auditor. O auditor deve verificar, em toda janela de deploy, se houve mudança na REMO e se o deploy manual foi executado e reportado. Esta regra permanece até que o responsável autorize explicitamente o upgrade para Vercel Pro.
