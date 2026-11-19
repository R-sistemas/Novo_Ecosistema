# Pacote de aprovação · Catálogo do painel de loja

**Base:** `e5c5a86346dd628959aa031182549614ab9b54f7` em `main`. **Entrega:** `codex/painel-catalogo`. A publicação e a execução no banco exigem autorização.

## Escopo

- `/admin-loja.html` autentica pelo transporte Supabase compartilhado, lista apenas vínculos de gestor e confere o contexto no endpoint de sessão. O catálogo pagina por UUID em ordem estável, com 25 produtos e cursor de próxima página, incluindo inativos.
- A UI cria, edita, oculta e reativa produtos. Código, preço, modo de venda, textos e imagem seguem as regras e o conversor reaproveitados do PDV. O painel preserva foto existente quando o operador não a altera. Atividade, visibilidade e destaque são três campos separados. A vitrine exige atividade e visibilidade, como o checkout legado; o modo por peso continua exclusivo do PDV. Nenhum registro histórico de pedido ou venda é regravado.
- `GET/POST /api/painel-catalogo` usa o dispatcher Vercel existente. As RPCs validam o vínculo de gestor com `painel_contexto_sessao`, executam com o usuário chamador e usam a RLS de produtos. O UPDATE também escopa pelo ID e pela empresa. Uma tentativa com empresa alheia recebe 403; um ID alheio apresentado sob uma empresa própria recebe 404 sem revelar o produto. O REST legado do PDV continua em uso e passa pelo mesmo trigger.

## Migrations

| Versão | Responsabilidade |
| --- | --- |
| `202611190049` | Auditoria transacional por linha em INSERT, UPDATE e DELETE. O trigger de TRUNCATE registra uma exclusão por produto antes da operação. O único escritor privilegiado é o trigger fixado no schema privado. |
| `202611190050` | Duas RPCs invoker com `search_path` fixo e EXECUTE somente para `authenticated`. Paginação por empresa com limite de 1 a 50 e escrita limitada aos campos de produto. |
| `202611190051` | Corrige a vitrine para respeitar `visivel_cardapio`. Preserva a assinatura, tipo, configuração e grants da definição efetiva. |

A auditoria usa o UUID de `auth.uid()` e registra a origem usuário, serviço ou sistema. Para operações sem usuário, `autor_id` usa UUID zero para preservar o contrato não nulo. Antes/depois incluem identificador da empresa, preço e flags operacionais. Nomes, códigos, categorias, descrições, composição, fotos e outros valores de texto livre são omitidos. INSERT e DELETE preservam o lado ausente como nulo. Uma falha no INSERT de auditoria aborta a mutação do produto.

## Pré-voo e validação

A consulta de produção foi somente leitura, no ref `eyqxxlcmxlilgogxdcoq` e host `eyqxxlcmxlilgogxdcoq.supabase.co`. Conferiu colunas, restrições, proprietário, ACL, RLS, políticas, triggers, definições efetivas de autenticação, sessão, vitrine e proteção da auditoria. `produtos` aceita SELECT/INSERT/UPDATE de `authenticated`, sujeito às políticas existentes. O corpo de `ver_cardapio(text)` coincidiu com o da migration `202611150045` na base indicada. O pacote de evidência separado traz a consulta exata, timestamp e saída sanitizada.

O teste `tests/painel-catalogo.mjs` executa as migrations da árvore saneada em PostgreSQL 17 descartável. Exercita RPC direta, dispatcher HTTP, escrita REST do cliente legado, falha injetada no caminho de gravação da auditoria, snapshots históricos, visibilidade pública e TRUNCATE com origem de serviço. O Chrome headless exercita a página real, bloqueia uma loja alheia pela URL e reativa um produto. O transporte Auth/PostgREST é simulado localmente e encaminha a RPC ao PostgreSQL real do ensaio. `tests/painel-sessao.mjs` cobre a regressão da base.

Após autorização, homologue num ambiente separado com JWT real de dois gestores e um operador. Exercite os 200 próprios, os 403 cruzados nas duas direções, 403 do operador e 401 sem sessão. Confirme reativação, visibilidade e destaque, a trilha de mutações feitas pelo painel e pelo PDV, uma falha injetada na auditoria somente em ambiente descartável, e os preços persistidos de venda e pedido. Registre só rótulos anonimizados, status, revisão, projeto, host e horário.

O [runbook do primeiro papel central](PAINEL_CENTRAL_RUNBOOK.md) descreve concessão e revogação controladas e auditadas.
