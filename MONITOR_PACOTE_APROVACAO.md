# Monitor do gestor · Pacote de aprovação do recorte da Etapa 3

Branch `codex/modularizar-monitor`, criada diretamente da main `d50ab7f0caf5c7d1a710023143e844bb9b7cd9c6`. Código validado no commit `67ddc4d48dafd24d12ed592e2520dc1fc025217e`.

## Responsabilidades

O entry `monitor.mjs` passou de 186 para três linhas. Interface, estado por instância, descrição pura de registros e transporte HTTP têm módulos próprios. O estado é criado somente na inicialização e fornecido por contexto aos demais módulos.

A formatação monetária e a busca de elementos reutilizam `pdv/interface/elementos.mjs`, que já usa `pdv/regras/moeda.mjs`. Os estados de entrega reutilizam `estado-entrega.mjs`. As tabelas de rótulos e os formatadores de data e hora do monitor ficam no módulo de regras de registros.

O monitor continua exibindo pedidos, recebimentos, entregas e alertas de saldo REMO. O despacho é apresentado como estado e alerta nessa tela.

## Contratos e verificações estáticas

- A URL pública continua `monitor.html` com o entry `monitor.mjs`.
- O transporte permanece POST `/api/monitor-gestor`, com `acao` e os mesmos campos, cache no-store e timeout de 20 segundos. O tratamento de HTTP 204 e de erros conserva a implementação original.
- As ações continuam `lojas`, `entrar`, `consultar` e `sair`.
- Foram preservados o descarte de resposta antiga ao trocar loja ou dia, a atualização após a consulta pendente terminar e a espera dessa consulta antes do logout.
- As atualizações periódicas de 20 segundos e os gatilhos online/visibilidade continuam presentes.
- HTML, CSS, API, bibliotecas do servidor, CSP, PWA e dependências compartilhadas permanecem iguais à base.

A análise estática conferiu nomes referenciados, sintaxe, caminhos dos imports, limites e consumidores. A função HTTP extraída foi comparada com a função original. As interfaces usam o módulo de dados para HTTP, e as regras não acessam DOM ou rede. `git diff --check` passou.

O módulo de dados tem nove linhas e concentra o contrato HTTP completo, incluindo POST, JSON, timeout, resposta 204 e erros. Seu tamanho corresponde à função de transporte existente, agrupada pelo domínio monitor.

## Testes em navegador

A mesma suíte passou com o código original de `d50ab7f` e com a versão modularizada. O servidor local aplicou ao HTML a política CSP definida para monitor.html na Vercel. Chrome carregou os módulos reais e executou os eventos da tela. A API foi simulada.

```text
PASS sessao
PASS login
PASS login-falha
PASS 401
PASS 403
PASS 500
PASS rede
PASS vazio
PASS troca-loja
PASS troca-dia
PASS logout
PASS logout-falha
PASS eventos
13 fluxos do monitor em Chrome aprovados.
```

Passos e resultados observados:

1. Sessão existente — carregar lojas, consultar indicadores, abrir abas de recebimentos e entregas, conferir valores, rótulos, paginação informativa e alerta de saldo REMO.
2. Login — exibir formulário após 401 inicial, preencher credenciais fictícias e acessar o painel. A falha de login mostra a mensagem e limpa a senha.
3. HTTP 401 e 403 durante atualização — o monitor retorna ao login com a mensagem do servidor.
4. HTTP 500 e erro de rede — o painel conserva os dados já carregados e apresenta a orientação de tentar atualizar.
5. Lista vazia — a tela apresenta a ausência de registros.
6. Troca de loja e dia — manter a primeira consulta pendente, alterar o filtro e liberar a resposta antiga. Conferir que o registro antigo não foi renderizado e que a consulta seguinte usa o filtro novo.
7. Logout — manter consulta pendente e clicar em Sair. A ação sair aguarda a resposta, limpa a lista de lojas e retorna ao login. HTTP 204 é aceito.
8. Falha de logout — o painel continua disponível e a mensagem permite nova tentativa.
9. Eventos — disparar online, visibilitychange e avançar o relógio do navegador em 20 segundos. Cada gatilho realiza uma nova consulta.

Para repetir, executar `node tests/monitor-fluxo.mjs` com Chrome e Playwright disponíveis. A variável opcional `PLAYWRIGHT_MODULE` aceita o caminho da biblioteca. Um argumento opcional aceita o diretório do código original.

A autenticação e as respostas financeiras/logísticas foram simuladas. Cookies reais, renovação real da sessão e dados autenticados de produção dependem de validação na publicação autorizada. Nenhuma operação foi executada em contas de produção.

## Confinamento, limpeza e estado Git

O worktree deste recorte fica em `C:/Users/RAFAEL_C/Desktop/Ecosistema/_arquivo_morto/worktrees/monitor`. A branch fica limpa e sincronizada com origin após o push.

Os worktrees temporários de cardápio, checkout e index, já aprovados, foram removidos. Antes de cada remoção, foram conferidos caminho interno, ausência de alterações e arquivos não rastreados/ignorados, e igualdade de HEAD com a branch remota. As branches e os relatórios permanecem preservados no GitHub.

| Recorte aprovado | Branch preservada | Commit |
| --- | --- | --- |
| Cardápio | codex/modularizar-cardapio | ee93474 |
| Checkout | codex/modularizar-checkout-entrega | 6002a25 |
| Index | codex/modularizar-index | 7438e3c |

Restam o worktree principal da R Sistemas, este worktree de revisão e o worktree próprio da REMO, todos dentro de Desktop/Ecosistema. A remoção do worktree do monitor fica pendente para o encerramento de sua auditoria.

A main principal conserva a alteração preexistente na .vercelignore e o documento não rastreado Remo_Logistica_Escopo_Final_Calculo_de_Frete.docx. Esses arquivos foram preservados. O estado limpo se aplica à branch entregue.

## Próximo passo e integração

Este é o quarto recorte solicitado da Etapa 3 e aguarda auditoria. Quando houver autorização explícita para integração, cada recorte aprovado terá seu próprio merge, com um ponto independente de rollback. A validação conjunta e a publicação manual pela Vercel seguem pendentes dessa autorização.

Os testes e este documento seguem excluídos do deploy pelas regras existentes. O autoatendimento continua bloqueado até a ordem específica do responsável.

## Inventário de linhas

Um travessão indica arquivo novo. Este relatório é excluído de sua própria contagem.

| Caminho | Antes | Depois |
| --- | ---: | ---: |
| monitor.mjs | 186 | 3 |
| monitor/dados/monitor.mjs | — | 9 |
| monitor/interface/atualizacao.mjs | — | 42 |
| monitor/interface/eventos.mjs | — | 20 |
| monitor/interface/iniciar.mjs | — | 26 |
| monitor/interface/renderizacao.mjs | — | 57 |
| monitor/interface/sessao.mjs | — | 46 |
| monitor/regras/estado.mjs | — | 9 |
| monitor/regras/registros.mjs | — | 21 |
| tests/monitor-fluxo.mjs | — | 149 |
