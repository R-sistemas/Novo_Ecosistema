# R Sistemas

## Arquitetura e regras de construção

A construção deve ser modular e desacoplada. As regras obrigatórias estão em [AGENTS.md](AGENTS.md) e valem desde a primeira entrega. Cada módulo tem responsabilidades claras, uma fonte de verdade para seus dados e interfaces explícitas. Reutilize regras e funções existentes, centralize as operações de escrita e remova código morto com segurança.

## Entregas e critérios de produção

1. **PDV web.** Validar a interface local e conectar autenticação, catálogo, vendas e caixa ao Supabase. Implementar papéis de gestor e operador, isolamento por empresa e transações de venda e caixa no banco. Validar com duas empresas de teste e um turno real com fechamento conferido.
2. **Cardápio PWA e KDS.** Oferecer link público por loja, QR exclusivo de mesa, carrinho, retirada e acompanhamento. Compartilhar o pedido com a cozinha e o caixa. Validar pedido real pelo link e pelo QR, preparo e recebimento registrado pelo operador.
3. **REMO na Vercel.** Manter marca, portal e API próprios. Adaptar a central existente, quando viável, para aceitar ordens integradas e manuais, cotar frete, debitar uma vez por ordem e rastrear a corrida ativa. Validar as duas origens de ordem em produção antes de desligar o Railway.
4. **Replicação.** Ativar uma segunda empresa real por configuração, com dados e identidade próprios.
5. **Asaas.** Confirmar o modelo de recebimento por loja e homologar Pix no sandbox. Validar confirmação autenticada, idempotência, expiração e devolução antes de habilitar pagamentos no cardápio.

## Pagamentos online

O Quiosque usa a própria conta Asaas de produção. A configuração de provedores e meios é por estabelecimento e ambiente. As credenciais ficam no servidor, vinculadas à conta da loja.

O Asaas atende exclusivamente ao Pix. Após validar o Pix, selecionar outro provedor para cartão de crédito e débito online, com exceção do PagBank. Avaliar as taxas efetivas, o prazo de repasse, o suporte técnico e a facilidade de homologação. A página de pagamento do provedor coleta os dados do cartão. Confirmar o pagamento pelo provedor antes de liberar o pedido.

Novas integrações serão adicionadas conforme a demanda das lojas e os meios oferecidos por cada instituição.

## Infraestrutura e identidade

GitHub para o código, Vercel para os aplicativos e Supabase para dados e autenticação. A REMO compartilha infraestrutura inicialmente e mantém operação independente. O cardápio público destaca a marca de cada loja. O piloto exclui campanhas, remarketing e QR de marketing. O OSRM fica fora do custo inicial até a necessidade de roteamento viário ser validada.

A primeira entrega local usa a logo fornecida e aproxima a tipografia com uma fonte de sistema. Os dados são fictícios e persistem apenas no navegador. Antes da produção, substituir essa persistência por operações autenticadas e transacionais no Supabase. Nenhuma etapa da tabela está concluída até a validação em produção.
