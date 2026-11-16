# Autoatendimento — etapa obrigatória do fechamento

Decisão informada por Rafael em 16/11/2026: o ciclo do ecossistema inclui um ponto de autoatendimento. A maquininha disponível é a **Moderninha Smart 2**. Em 16/11/2026, Rafael pediu para planejar o cartão presencial com uma **Mercado Pago Point integrada pela Orders API**, sem efetuar a compra ainda. Esta etapa permanece **pendente** até teste completo em produção no equipamento físico.

## Experiência aprovada para desenvolver

- Terminal Android dedicado exibe o cardápio da loja em tela cheia e impede o cliente de sair para outros aplicativos ou configurações. A saída para manutenção exige autenticação administrativa e fica registrada.
- O QR é **lido pelo próprio terminal Android** para instalar/configurar o aplicativo de autoatendimento e ativar o modo de dispositivo dedicado. Foi confirmado por Rafael em 16/11/2026. Ele não é um QR para o cliente instalar o cardápio no telefone.
- O pedido feito no terminal usa o mesmo catálogo, identificador de pedido, cozinha, PDV e regras financeiras do ecossistema. A origem `autoatendimento` identifica o canal sem criar uma segunda base de pedidos.
- Pix exibe QR e só libera pedido/comprovante após confirmação autenticada do provedor. Para cartão presencial, o caminho preferido é Point pela Orders API: o servidor cria uma `order` com valor, terminal e referência única do pedido; o Point recebe a cobrança pela rede do Mercado Pago; o servidor recebe webhook `order.processed`, valida assinatura, referência, valor e estado, persiste a aprovação de forma idempotente; o Android consulta/assina o estado do pedido e imprime pela Bematech. A impressão do comprovante ocorre uma vez após a confirmação, com reimpressão auditada.
- A ponte Android para a Bematech MP-4200 TH descrita no plano geral deve ser localizada e validada no equipamento real antes de reaproveitamento. A PWA no navegador não acessa a impressora USB por essa ponte sozinha.
- O aplicativo deve funcionar em celular ou tablet Android com USB host; a escolha da marca/modelo do terminal não bloqueia o desenvolvimento. O Galaxy A15 já imprimiu com o APK legado, segundo teste relatado por Rafael. A compatibilidade de cada aparelho final ainda será validada fisicamente.
- Na cozinha atual, **Iniciar preparo** aceita o pedido no servidor e em seguida envia a via de produção à Bematech pelo aplicativo Android. No autoatendimento, a via do comprador inclui número do pedido, itens, valores e identificação do pagamento, mas só é emitida depois da confirmação autenticada e persistida da transação. Uma tentativa, QR exibido ou resposta local da maquininha sem conciliação não autoriza impressão nem liberação à cozinha.

## Comunicação entre Android, impressora e maquininha

- A Bematech é USB local e exige ponte no APK Android do autoatendimento. O APK também controla o modo dedicado do aparelho.
- O Android oferece **lock task mode** para aparelhos dedicados sob gerenciamento do proprietário. Fixar uma tela manualmente é diferente: o usuário pode sair. O aplicativo do terminal deverá controlar entrada/saída administrativa e recuperação após reinício.
- Na integração Point via Orders API, o Android **não** emparelha com a maquininha nem recebe o Access Token. A comunicação Android → servidor → Mercado Pago → Point e o retorno por webhook passam pela internet. O servidor é a fonte de verdade para liberar cozinha, PDV e impressão. O APK da Bematech não se torna um aplicativo de pagamento.
- A conta Mercado Pago já utilizada pelo Pix pode ser aproveitada para a integração presencial, mas será preciso configurar aplicação/credenciais, loja, caixa, terminal Point em modo integrado, `external_reference`, chave de idempotência e webhook do tópico `order`. Não assumir que o webhook atual de Pix cobre automaticamente o tópico Point.
- A documentação atual lista Point Smart 2 e Point Pro 3 entre os terminais compatíveis. Smart 2 é a indicação inicial, sujeita à confirmação do uso sem atendente e aos testes de cobrança real. A Orders API permite simular estados com terminal virtual antes da compra. Esta integração por API é distinta de instalar um SmartApp na Point.
- Em `created`, `at_terminal` ou `action_required`, mostrar espera ou instrução ao comprador, sem marcar o pedido pago. Só `processed` com transação acreditada e dados conciliados autoriza impressão e preparo. Tratar falha, cancelamento, expiração, webhook repetido e retomada após reinício.

Fontes oficiais: [Point via Orders API](https://www.mercadopago.com.br/developers/pt/docs/mp-point/payment-processing), [terminais compatíveis](https://www.mercadopago.com.br/developers/pt/docs/mp-point/overview), [webhooks](https://www.mercadopago.com.br/developers/pt/docs/mp-point/notifications), [estados](https://www.mercadopago.com.br/developers/pt/docs/mp-point/resources/status-order-transaction), [testes](https://www.mercadopago.com.br/developers/pt/docs/mp-point/integration-test).

## Alternativa PagBank que depende de homologação

A documentação PagBank classifica a Moderninha Smart 2 na família SmartPOS. Aplicativo instalado na maquininha usa SDK Android nativo, parceria comercial, terminal de desenvolvimento e homologação. O PagBank informa que WebApps/WebView não são aceitos como aplicativo SmartPOS. A lista oficial de terminais PlugPag Bluetooth inclui Minizinha, Moderninha Plus e Moderninha Pro, **não** a Smart 2; portanto, não assumir que instalar um APK no Android do autoatendimento conectará a Smart 2 por Bluetooth. **Uma transação digitada manualmente na maquininha não confirma automaticamente o nosso pedido.** Rafael relata que o contato comercial/homologação PagBank anterior ficou sem resposta por mais de 120 dias; manter esta alternativa suspensa até haver integração suportada e aprovação concreta.

Fontes oficiais consultadas: [Android lock task](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [PagBank integração SmartPOS](https://developer.pagbank.com.br/docs/integracao-smartpos-1), [PagBank FAQ SmartPOS](https://developer.pagbank.com.br/docs/faq-smartpos), [PagBank PlugPag](https://developer.pagbank.com.br/docs/plugpag).

## Critérios de conclusão em produção

- [x] Localizar e auditar o projeto Android legado `DoRafaKDSPrint`; resultados em `AUDITORIA_ANDROID_AUTOATENDIMENTO_2026-11-16.md`.
- [x] Integrar o aceite da cozinha à ponte Android USB em código e compilar um APK de teste separado do legado. Versão web publicada em 16/11/2026; teste físico da nova versão ainda pendente.
- [ ] Testar a ponte USB com a Bematech física, confirmação e reimpressão.
- [ ] Provisionar o aparelho escolhido como dispositivo Android dedicado; testar bloqueio, reinício e saída administrativa. Celular ou tablet são opções válidas.
- [ ] Publicar interface de autoatendimento reutilizando catálogo, checkout e pedido, com provisionamento do terminal por QR e isolamento entre compradores.
- [ ] Integrar Pix com confirmação real e idempotente, imprimir apenas após confirmação e conferir o registro no KDS/PDV.
- [ ] Simular Point Orders API com terminal virtual, webhook e confirmação idempotente do pedido, sem aparelho físico; confirmar com Mercado Pago o uso sem atendente antes de adquirir o terminal.
- [ ] Associar uma Point compatível à conta, loja e caixa, configurar o modo integrado e validar cobrança presencial real, conciliação e impressão. Se a opção PagBank voltar a ser considerada, exigir antes a interface suportada e a homologação da Smart 2.
- [ ] Testar transações aprovadas, recusadas, interrompidas e repetidas, sem criar pedidos pagos ou impressões duplicadas.

As decisões de débito online suspenso, devolução financeira manual, REMO pré-paga e ausência de retirada no checkout público de entrega permanecem válidas. O autoatendimento presencial é um canal distinto do checkout público de entrega.
