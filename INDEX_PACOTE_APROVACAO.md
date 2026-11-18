# index.html · Pacote de aprovação do recorte da Etapa 3

Branch `codex/modularizar-index`, criada diretamente da main `d50ab7f0caf5c7d1a710023143e844bb9b7cd9c6`. Código validado no commit `ac47082fd028269785e28c4d144e6d4e0f21ff96`.

## Mudança

A página estática foi dividida por responsabilidade. A seção administrativa completa foi extraída para um partial HTML. A página carrega esse markup e só então importa o entry público `pdv.mjs`. A interface e o acesso HTTP ao partial têm módulos próprios. O projeto continua sem build e sem dependência nova de servidor.

| Arquivo | Antes | Depois | Responsabilidade |
| --- | ---: | ---: | --- |
| index.html | 303 | 192 | Estrutura principal, frente de caixa e diálogos existentes |
| pdv/partes/administracao.html | — | 112 | Seção administrativa com os formulários existentes |
| pdv/interface/pagina.mjs | — | 28 | Inserção do partial, inicialização ordenada e recuperação de falhas |
| pdv/dados/pagina.mjs | — | 12 | Leitura HTTP do HTML, verificação de status e conteúdo vazio |
| tests/index-fluxo.mjs | — | 168 | Comparação do DOM e fluxos em Chrome |

Nenhum arquivo foi removido. A mudança de HTML preserva a seção, os IDs, os atributos, os controles, os textos e sua posição na árvore. O marcador template é substituído pelo fragmento, sem wrapper adicional. O carregador de página mantém o login inerte até o PDV terminar de iniciar.

Se o partial falhar por rede, HTTP, conteúdo vazio ou estrutura inválida, o login continua bloqueado e a página oferece um botão Recarregar. A recuperação por esse botão foi exercitada em navegador.

## Contratos e consumidores

As URLs públicas continuam `/`, `/index.html` e `/pdv.mjs`. O index passa a referenciar o módulo de página, que importa o mesmo entry do PDV após inserir a administração. O partial novo tem como consumidor o módulo de dados; esse módulo é consumido pela interface da página.

Não houve alterações em regras de negócio, payloads, APIs, Supabase, REMO, Mercado Pago, PWA ou CSS. Os módulos existentes do PDV e a conversão de moeda permanecem iguais à base. Não foi criado JavaScript inline nem handler de evento inline no HTML.

Foi conferida a ausência de dependências do PDV que precisassem de um evento DOMContentLoaded ainda pendente. Os módulos existentes inicializam pelos elementos do documento, que já estão disponíveis quando são importados.

## Provas de aceite

A referência em `d50ab7f` passou em três verificações de Chrome. A versão extraída passou nas mesmas três e em seis verificações específicas do carregamento e da recuperação do partial.

```text
PASS DOM completo, atributos, textos e hierarquia iguais à base
PASS vendas login e operação com serviços simulados
PASS administracao login e operação com serviços simulados
PASS recarregar após falha recupera a página
PASS falha de partial http mantém login bloqueado e permite recarregar
PASS falha de partial rede mantém login bloqueado e permite recarregar
PASS falha de partial vazio mantém login bloqueado e permite recarregar
PASS falha de partial invalido mantém login bloqueado e permite recarregar
PASS PDV aguarda o partial antes de iniciar
9 verificações em Chrome aprovadas.
```

Passos executados e resultados:

1. Comparar a árvore do body montado com o HTML original — tags, atributos, textos e hierarquia foram iguais, ignorando apenas nós de whitespace de formatação. Nessa verificação, o entry do PDV é simulado para observar o DOM antes das transformações já existentes da administração.
2. Login em Vendas — autenticar, selecionar loja, abrir caixa com R$ 10,00, abrir o catálogo, adicionar produto, escolher dinheiro, informar R$ 20,00 e finalizar. A UI confirmou a venda, o registro foi chamado uma vez e a abertura enviada foi de 1.000 centavos.
3. Login em Administração — abrir o formulário de mesa, solicitar o link da mesa 7 e conferir o endereço canônico cardapio.html com os parâmetros de loja e mesa. Abrir cadastro de operador, escolher Cozinha e conferir que o campo de novo caixa fica oculto.
4. Injetar falhas de HTTP, rede, HTML vazio e HTML inválido — o entry do PDV não é importado e o login permanece inerte.
5. Recarregar após erro HTTP — o partial volta a carregar, o login é liberado e a seção administrativa aparece uma única vez.
6. Atrasar a resposta do partial — o login permanece inerte; o entry só é importado quando o fragmento já está no DOM.

Nos testes de fluxo, os módulos reais do PDV, o HTML e os eventos do navegador foram executados. As respostas Supabase e as operações de venda/caixa foram simuladas. Nenhum usuário, caixa ou venda de produção foi alterado.

A análise confirmou os limites dos cinco arquivos, ausência de scripts e handlers inline no HTML, sintaxe dos módulos e `git diff --check`. Os consumidores foram verificados com `git grep`.

Para repetir, executar `node tests/index-fluxo.mjs` com Chrome e Playwright disponíveis. A variável opcional `PLAYWRIGHT_MODULE` aponta para a biblioteca do ambiente. O argumento opcional seguinte aceita o diretório com o código original. Testes e este documento continuam excluídos do deploy pelas regras existentes.

## Limitações

Há uma nova requisição HTTP de markup antes de inicializar o PDV. A falha desse recurso é tratada conforme os testes acima. O HTML montado e os fluxos foram validados localmente em Chrome; autenticação real, venda real, impressão e validação pós-deploy dependem da etapa de publicação autorizada.

## Confinamento e pendências

O worktree deste recorte fica em `C:/Users/RAFAEL_C/Desktop/Ecosistema/_arquivo_morto/worktrees/index`. Todos os worktrees da R Sistemas e REMO estão dentro de Desktop/Ecosistema. A branch entregue fica limpa e enviada ao origin.

A main principal conserva a alteração preexistente na .vercelignore e o documento não rastreado Remo_Logistica_Escopo_Final_Calculo_de_Frete.docx. Nenhum dos dois foi incluído nesta branch. O estado limpo se aplica ao worktree entregue.

A limpeza dos worktrees temporários dos recortes aprovados continua pendente para o encerramento da Etapa 3, com conferência de branches enviadas e ausência de trabalho local antes da remoção.

## Integração registrada pelo responsável

Quando a integração for explicitamente autorizada, haverá um merge individual por recorte aprovado, preservando um ponto independente de rollback para cardápio, checkout, index e monitor. Os quatro recortes não serão agrupados em um único merge. Deploy continua sujeito à autorização explícita e será manual pela CLI.

Este pacote aguarda auditoria. O próximo recorte será monitor.mjs após aprovação do index.
