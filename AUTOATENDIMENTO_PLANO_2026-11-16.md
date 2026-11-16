# Autoatendimento — etapa obrigatória do fechamento

Decisão informada por Rafael em 16/11/2026: o ciclo do ecossistema inclui um ponto de autoatendimento. A maquininha disponível é a **Moderninha Smart 2**. Esta etapa permanece **pendente** até teste completo em produção no equipamento físico.

## Experiência aprovada para desenvolver

- Terminal Android dedicado exibe o cardápio da loja em tela cheia e impede o cliente de sair para outros aplicativos ou configurações. A saída para manutenção exige autenticação administrativa e fica registrada.
- Um QR visível abre o cardápio público no telefone do cliente, onde ele pode instalar a PWA. Esse QR não confere privilégios de manutenção nem transfere a sessão do terminal.
- O pedido feito no terminal usa o mesmo catálogo, identificador de pedido, cozinha, PDV e regras financeiras do ecossistema. A origem `autoatendimento` identifica o canal sem criar uma segunda base de pedidos.
- Pix exibe QR e só libera pedido/comprovante após confirmação autenticada do provedor. O caminho de cartão envia o valor e a referência do pedido à Moderninha Smart 2 e aguarda o resultado verificável da transação. A impressão do comprovante de pedido ocorre uma vez após a confirmação, com reimpressão auditada.
- A ponte Android para a Bematech MP-4200 TH descrita no plano geral deve ser localizada e validada no equipamento real antes de reaproveitamento. A PWA no navegador não acessa a impressora USB por essa ponte sozinha.

## Escolha técnica que depende de homologação

O Android oferece **lock task mode** para aparelhos dedicados sob gerenciamento do proprietário. Fixar uma tela manualmente é diferente: o usuário pode sair. O aplicativo do terminal deverá controlar entrada/saída administrativa e recuperação após reinício.

A documentação PagBank classifica a Moderninha Smart 2 na família SmartPOS. Aplicativo instalado na maquininha usa SDK Android nativo, parceria comercial, terminal de desenvolvimento e homologação. O PagBank informa que WebApps/WebView não são aceitos como aplicativo SmartPOS. Portanto, o cardápio no terminal dedicado e a integração nativa na maquininha são componentes separados até que o provedor confirme uma interface de comunicação aprovada entre eles. **Não assumir que uma transação digitada manualmente na maquininha envie automaticamente a aprovação ao nosso pedido.**

Fontes oficiais consultadas: [Android lock task](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [PagBank integração SmartPOS](https://developer.pagbank.com.br/docs/integracao-smartpos-1), [PagBank FAQ SmartPOS](https://developer.pagbank.com.br/docs/faq-smartpos), [PagBank Moderninha Smart 2](https://pagbank.com.br/para-seu-negocio/maquininhas/moderninha-smart-2).

## Critérios de conclusão em produção

- [ ] Localizar o projeto Android legado `DoRafaKDSPrint`, identificar versão, ponte USB e limitações; testar Bematech física, confirmação e reimpressão.
- [ ] Definir o aparelho do terminal e provisioná-lo como dispositivo Android dedicado; testar bloqueio, reinício e saída administrativa.
- [ ] Publicar interface de autoatendimento reutilizando catálogo, checkout e pedido, com QR público e isolamento entre compradores.
- [ ] Integrar Pix com confirmação real e idempotente, imprimir apenas após confirmação e conferir o registro no KDS/PDV.
- [ ] Confirmar com PagBank o procedimento de parceria, homologação e comunicação com a Moderninha Smart 2; implementar a ponte aprovada e conciliar identificador, valor, estado e comprovante da transação.
- [ ] Testar transações aprovadas, recusadas, interrompidas e repetidas, sem criar pedidos pagos ou impressões duplicadas.

As decisões de débito online suspenso, devolução financeira manual, REMO pré-paga e ausência de retirada no checkout público de entrega permanecem válidas. O autoatendimento presencial é um canal distinto do checkout público de entrega.
