# Checkout de entrega · Pacote de aprovação da Etapa 3

Branch de revisão `codex/modularizar-checkout-entrega`, criada diretamente em `d50ab7f0caf5c7d1a710023143e844bb9b7cd9c6`. Commit do código validado `fce5239442427187948d84ecf9904eef450fcfff`.

## Alterações

O entry público `checkout-entrega.mjs` passou de 329 para uma linha e reexporta a função assíncrona `iniciarCheckoutEntrega` pelo mesmo nome. Os módulos recebem contexto explícito. A construção do estado é importada somente pela inicialização, que também fornece a operação de reinício usada pela limpeza do carrinho.

A montagem do formulário, a apresentação, os eventos, a cotação concorrente, o aviso de frete alterado e a confirmação têm módulos de interface próprios. Telefone, troco e endereço ficam em regras puras. RPC, HTTP e persistência local ficam em dados. As duas conversões de troco usam `pdv/regras/moeda.mjs`; a apresentação monetária usa `paraReais`.

Nenhum arquivo foi removido. O formulário e os textos existentes foram preservados durante a extração. Os imports e consumidores foram conferidos por análise dos módulos e `git grep`.

## Contratos

- `cardapio.mjs`, HTML, estilos, `location-picker.mjs`, `credito-teste.mjs`, PWA e functions `api/` permanecem iguais à base.
- A chamada pública continua `iniciarCheckoutEntrega({ slug, menu, carrinho, aoConfirmar, aoPix })`.
- Permanecem as RPCs `pagamento_na_entrega_disponivel` e `metodos_checkout_publico`, incluindo os valores de fallback.
- Permanecem POST `/api/cotar-frete` e POST `/api/checkout-pix-mercado-pago-quiosque`, com os mesmos campos, métodos e tratamento de status. A confirmação Pix continua delegada a `aoPix`; crédito continua delegado a `abrirCreditoTeste`.
- Cancelamento de requisição, versão de cotação e conferência do pino foram preservados. A cotação é reconferida antes de pagar, e uma alteração exige confirmação explícita do novo frete.
- O identificador `p_id` é reutilizado nas repetições enquanto a assinatura do pedido permanece igual. Aceitar novo frete limpa essa tentativa.
- A chave local continua `checkout-entrega:<slug>:dados`. O salvamento é opcional, e indisponibilidade do armazenamento preserva o funcionamento do pedido.

## Prova de comportamento

A mesma suíte foi executada em Chrome real contra o código original da main e contra a branch refatorada. A interface, o diálogo, o mapa Leaflet, os eventos e o armazenamento são os reais do código. Tiles, respostas dos serviços e entrada de cartão são simulados nos cenários transacionais.

```text
PASS validacao
PASS pix
PASS dinheiro
PASS credito
PASS frete-alterado
PASS conflito
PASS repeticao
PASS metodos
PASS pino
PASS memoria
PASS limpeza
PASS armazenamento
12 fluxos de checkout em Chrome aprovados.
```

- Validação — adicionar produto, abrir carrinho e tentar avançar com contato vazio. Nome e telefone são marcados. Com contato válido e sem pino, a localização é marcada como obrigatória.
- Pix — clicar no mapa, aguardar cotação, preencher contato, avançar, selecionar Pix e confirmar. Conferidos frete, endereço, telefone normalizado, método e URL de acompanhamento.
- Dinheiro — selecionar pagamento em dinheiro, tentar troco abaixo do total, conferir a mensagem, informar R$ 20,00 e confirmar. O payload contém 2.000 centavos e método `dinheiro`.
- Crédito — escolher crédito, verificar a soma subtotal/frete e o payload entregue ao módulo existente, com flag de produção preservada. O callback de cartão é simulado.
- Frete alterado — a recotação muda de R$ 5,00 para R$ 7,00. O diálogo abre antes de qualquer criação de pagamento. Após aceitar e confirmar, o payload usa 700 centavos.
- Conflito HTTP 409 — o registro responde com novo frete. O diálogo permite aceitar o novo total e repetir a confirmação.
- Repetição — após HTTP 503 simulado, a confirmação seguinte usa o mesmo `p_id`.
- Métodos — com os recursos desabilitados pelas RPCs, Pix, crédito, dinheiro e maquininha aparecem desabilitados.
- Pino — duas seleções em posições diferentes geram cotações concorrentes. A primeira resposta é atrasada e tem preço diferente. Após a troca do pino, a resposta antiga é descartada e o pedido usa o endereço atual.
- Memória — salvar contato/localização, confirmar e reabrir o catálogo. Nome, telefone, checkbox e pino reaparecem.
- Limpeza — voltar para o contato preserva os valores. Limpar o carrinho e adicionar novamente reinicia os dados e o pino.
- Armazenamento indisponível — o browser simula erro ao acessar localStorage. A confirmação continua funcionando.

Também foi aberto o checkout com o catálogo público real do Quiosque Do’Rafa. O browser exibiu dois produtos, permitiu adicionar um produto, abriu o carrinho com total de R$ 28,00 e exibiu o mapa Leaflet. Foram chamadas somente as consultas `ver_cardapio`, `pagamento_na_entrega_disponivel` e `metodos_checkout_publico`. Essa conferência foi somente leitura.

Sintaxe, nomes, resolução de imports, limites por tipo, endpoints e nomes de RPC passaram na análise estática. Nenhum `Math.round` permanece nos módulos extraídos. As interfaces não importam Supabase nem chamam fetch diretamente. As regras não acessam DOM ou armazenamento. `git diff --check` passou.

Para repetir os fluxos, executar `node tests/checkout-entrega-fluxo.mjs` com Chrome e Playwright disponíveis. A variável opcional `PLAYWRIGHT_MODULE` aceita o caminho da biblioteca. O argumento opcional seguinte aceita o diretório com o código original.

## Confinamento, Git e limpeza dos worktrees

O recorte fica em `C:/Users/RAFAEL_C/Desktop/Ecosistema/_arquivo_morto/worktrees/checkout-entrega`. Após o push, a branch de revisão fica limpa e sincronizada. Todos os worktrees da R Sistemas e REMO ficam dentro de `Desktop/Ecosistema`.

A main principal já tinha alterações locais da `.vercelignore` e o arquivo `Remo_Logistica_Escopo_Final_Calculo_de_Frete.docx` não rastreado. Esses arquivos foram preservados. O estado limpo se aplica à branch entregue, enquanto a main conserva esse trabalho preexistente.

Os worktrees de `cardapio` e `checkout-entrega` são temporários. Sua remoção está pendente para o encerramento de todas as etapas, após confirmar branches enviadas e ausência de trabalho local. Nenhum caminho absoluto externo foi acrescentado ao código ou aos testes.

## Limitações e próximo passo

A conferência real chegou à abertura do carrinho e mapa. Cotação remota, criação de cobrança, cartão, entrega e financeiro foram simulados nos testes. GPS físico e disponibilidade de rede dos provedores dependem de validação própria.

O pacote aguarda auditoria do responsável. Merge e deploy dependem de autorização explícita. O próximo recorte será `index.html`, após aprovação deste checkout.

## Inventário de linhas

Um travessão indica arquivo novo. Este documento é excluído da sua própria contagem.

| Caminho | Antes | Depois |
| --- | ---: | ---: |
| checkout-entrega.mjs | 329 | 1 |
| checkout-entrega/dados/checkout.mjs | — | 24 |
| checkout-entrega/dados/persistencia.mjs | — | 20 |
| checkout-entrega/interface/apresentacao.mjs | — | 63 |
| checkout-entrega/interface/confirmacao.mjs | — | 73 |
| checkout-entrega/interface/cotacao.mjs | — | 62 |
| checkout-entrega/interface/estrutura.mjs | — | 27 |
| checkout-entrega/interface/eventos.mjs | — | 45 |
| checkout-entrega/interface/frete-alterado.mjs | — | 21 |
| checkout-entrega/interface/iniciar.mjs | — | 40 |
| checkout-entrega/regras/estado.mjs | — | 17 |
| checkout-entrega/regras/pedido.mjs | — | 24 |
| tests/checkout-entrega-fluxo.mjs | — | 162 |
