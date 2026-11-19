# Cardápio · Pacote de aprovação do primeiro recorte da Etapa 3

Branch de revisão `codex/modularizar-cardapio`, criada em `d50ab7f0caf5c7d1a710023143e844bb9b7cd9c6`. Commit de código `4f910b9ad058b157f518baddd2e2ba828fce5219`.

## Mudanças e responsabilidades

`cardapio.mjs` passou de 404 para 3 linhas e inicializa a interface. O contexto da URL e os estados da sessão ficam em regras. O acompanhamento calcula estados e mensagens em uma função pura, reutilizando `estado-entrega.mjs` e `pdv/regras/moeda.mjs`. As interfaces recebem contexto explícito e usam os módulos de dados para RPCs e HTTP.

| Caminho | Antes | Depois | Responsabilidade |
| --- | ---: | ---: | --- |
| cardapio.mjs | 404 | 3 | Bootstrap público |
| cardapio/interface/iniciar.mjs | — | 82 | Inicialização, tema, vitrine e delegação ao checkout existente |
| cardapio/interface/acompanhamento.mjs | — | 43 | Feedback, renderização e acompanhamento periódico |
| cardapio/interface/pix.mjs | — | 15 | Renderização do QR e código Pix |
| cardapio/interface/frete.mjs | — | 50 | Eventos, cotação assíncrona e proteção contra respostas antigas |
| cardapio/interface/pagamento.mjs | — | 101 | Seleção de entrega, mesa e pagamento |
| cardapio/interface/envio.mjs | — | 93 | Fechamento, repetição, atualização da URL e delegação ao crédito existente |
| cardapio/regras/contexto.mjs | — | 45 | Parâmetros e estado por instância |
| cardapio/regras/acompanhamento.mjs | — | 21 | Estados, total e mensagem do pedido |
| cardapio/dados/pedidos.mjs | — | 22 | RPCs do catálogo e pedido, cotação e envio de entrega |
| cardapio/dados/pagamentos.mjs | — | 19 | Endpoints Pix e tratamento das respostas |
| tests/cardapio-fluxo.mjs | — | 137 | Regressão em navegador real |

Nenhum arquivo removido. Cada arquivo extraído tem consumidores comprovados por `git grep`. Os dados são agrupados por domínio. As interfaces recebem o contexto da inicialização, sem importar diretamente `supabase-pdv.mjs`.

## Contratos preservados

- Entry e links públicos continuam em `cardapio.html` e `cardapio.mjs`. O HTML permanece igual ao commit-base.
- Permanecem as RPCs `ver_cardapio`, `acompanhar_pedido`, `pix_online_disponivel`, `pagamento_na_entrega_disponivel` e `enviar_pedido`, com os mesmos payloads.
- Permanecem os endpoints de cotação, Pix Sandbox, Pix Mercado Pago de teste/quiosque e Pix quiosque, com os mesmos métodos, campos e erros.
- O fechamento preserva o identificador de tentativa enquanto o conteúdo do pedido permanece igual. A cotação usa sequência e chave do endereço para descartar respostas antigas.
- O checkout com mapa continua delegado a `checkout-entrega.mjs`. O crédito continua delegado a `credito-teste.mjs`. Esses módulos, PWA, HTML e APIs ficam iguais à base.

## Verificações executadas

O teste usa Chrome real em modo headless, abre o HTML, carrega os módulos por HTTP local e interage com os controles reais da tela. Supabase, pagamento, crédito e confirmação do checkout são interceptados nos cenários de escrita.

A mesma suíte passou no código original de `d50ab7f` e no código modularizado.

```text
PASS retirada
PASS mesa
PASS pix
PASS retomar
PASS entrega
PASS vazio
PASS credito
PASS retomar-pix
PASS pix-repetir
PASS quiosque
10 fluxos em Chromium aprovados.
```

Passos e observações dos cenários principais:

1. Retirada e mesa — adicionar produto, abrir carrinho, preencher cliente e confirmar. Observados payload de itens/cliente, URL do pedido e acompanhamento. Mesa conserva identificação e mensagem da comanda.
2. Pix — selecionar Pix e confirmar. Observado endpoint de pagamento e acompanhamento pendente. Ao reabrir pedido pendente, o QR e o código reaparecem.
3. Repetição de Pix — primeira resposta de pagamento simula HTTP 503. Após nova confirmação, ambos os envios usam o mesmo `p_id`.
4. Entrega — preencher endereço, sair do campo, aguardar cotação e confirmar. O teste preserva o evento de mudança de endereço e o frete confirmado antes do envio.
5. Crédito — confirmar a escolha, verificar o total enviado ao módulo existente e a atualização da URL no callback. A operação do PSP é simulada.
6. Quiosque — conferir a chamada ao checkout com slug/callbacks e as alterações de URL após o callback Pix. A renderização interna do mapa é responsabilidade do próximo recorte.
7. Catálogo vazio — observar a mensagem de indisponibilidade.

Também foi executada leitura real do catálogo público do Quiosque Do’Rafa com o código refatorado, sem interceptar as consultas Supabase. A tela exibiu dois produtos, permitiu adicionar um produto e abrir o carrinho, com total de R$ 28,00. Foram chamadas somente `ver_cardapio`, `pagamento_na_entrega_disponivel` e `metodos_checkout_publico`. Nenhum pedido ou cobrança foi enviado nessa validação.

Sintaxe, nomes referenciados, caminhos de import, limites por tipo e `git diff --check` passaram. Nenhum `Math.round` foi adicionado. Os testes e este documento são excluídos do deploy pelas regras já existentes.

Para repetir o teste, executar `node tests/cardapio-fluxo.mjs` com Playwright disponível e Chrome instalado. A variável opcional `PLAYWRIGHT_MODULE` permite apontar para a biblioteca do cache da ferramenta. O segundo argumento aceita o diretório original para comparação.

## Confinamento e estado Git

O worktree de revisão fica em `C:/Users/RAFAEL_C/Desktop/Ecosistema/_arquivo_morto/worktrees/cardapio`. Ele fica limpo e sincronizado após o push. O outro worktree da R Sistemas continua em `C:/Users/RAFAEL_C/Desktop/Ecosistema`, na main. O worktree da REMO continua em `C:/Users/RAFAEL_C/Desktop/Ecosistema/REMO`. Todos ficam dentro do diretório autorizado.

A main principal já tinha uma edição local de `.vercelignore` para excluir DOCX/PDF e o arquivo não rastreado `Remo_Logistica_Escopo_Final_Calculo_de_Frete.docx`. Essas alterações foram preservadas. Portanto, o status limpo se aplica à branch entregue, e a main principal mantém esse trabalho local preexistente.

Nenhum caminho externo foi adicionado ao código ou aos testes. O cache de ferramentas foi usado para TypeScript e Playwright. O teste aceita uma variável de ambiente para localizar Playwright e não fixa esse caminho no repositório.

## Limitações e pendências de aprovação

O fluxo com dados reais foi validado até o carrinho. Escrita de pedido, cobrança PSP, despacho REMO, entrada de cartão e callback de checkout foram simulados. GPS, mapa interno e emissão financeira real dependem de validação específica. O código do checkout segue para seu próprio recorte após esta auditoria.

Este pacote aguarda a revisão do responsável. Merge, deploy e validação pós-deploy dependem da aprovação explícita. O próximo arquivo será `checkout-entrega.mjs`, após aprovação deste recorte.
