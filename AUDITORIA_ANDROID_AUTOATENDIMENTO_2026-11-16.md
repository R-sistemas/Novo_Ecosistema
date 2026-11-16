# Auditoria do Android legado para autoatendimento — 16/11/2026

Fonte examinada: `C:\Users\RAFAEL_C\Desktop\Ecosistema\DoRafaKDSPrint`. Esta análise lê o código e os artefatos existentes; não substitui teste no aparelho e na Bematech físicos.

## O que já existe

- O módulo `app` é um invólucro Android WebView para o **KDS antigo**, com `KDS_URL = https://www.dorafatropicalbrasil.com.br/cozinha`. Publica a ponte JavaScript `AndroidPrint` e contém a rotina USB CDC ACM para a Bematech MP-4200 TH. O APK debug encontrado foi gerado em 29/08/2026. O README registra impressão funcional em produção naquele contexto; a compatibilidade com o novo KDS ainda não foi ensaiada.
- O módulo `printbridge` contém `UsbPrinter`, `EscPosBuilder` e um serviço de impressão Android. `UsbPrinter` concentra a sequência USB CDC ACM (115200 8N1, DTR/RTS, espera de 200 ms, escrita bulk, fechamento). Esse é o componente mais adequado para extrair para uma biblioteca de impressão reutilizável.
- O módulo `cantinas` é um aplicativo independente, offline, que também copiou a lógica de impressão. Ele não confirma pagamentos nem recebe pedidos do ecossistema atual.
- O novo KDS publicado em R Sistemas (`kds.html`/`cozinha.mjs`) não chama `AndroidPrint`. A simples troca da URL no aplicativo legado não ativa impressão no novo fluxo.

## O que impede usar o APK atual como ponto público

- Não há `DevicePolicyManager`, `startLockTask` ou controle de saída administrativa. O botão Voltar usa a navegação comum da WebView e depois pode sair do aplicativo.
- A WebView aceita navegação para qualquer URL e carrega conteúdo misto. A ponte `AndroidPrint` fica exposta à página carregada. O manifesto também aceita intents `dorafaprint:` de outros aplicativos. Antes de usar num terminal público, restringir origem, navegação, entrada de dados e chamadas nativas de impressão.
- `AndroidPrint.print()` espera no máximo 15 segundos por uma thread, mas essa thread pode continuar imprimindo depois de a chamada retornar falha. Um reenvio imediato pode duplicar o cupom. O novo fluxo precisa registrar o pedido e o resultado da impressão, permitir reimpressão explícita e auditar as tentativas.
- O aplicativo não contém pedido do autoatendimento, pagamento Pix/cartão, confirmação financeira, QR de provisionamento, isolamento entre clientes ou mecanismo de bloqueio do aparelho.

## Integração proposta

1. Preservar o KDS legado. Extrair a rotina USB comprovada para um módulo Android de impressão reutilizável, com impressão serializada, resultado assíncrono e teste na Bematech real.
2. Criar um aplicativo Android dedicado ao autoatendimento, com WebView restrita à origem publicada da R Sistemas e gerência do aparelho. Rafael confirmou que o QR é lido pelo **próprio terminal** para instalação/configuração. O Android recomenda provisionar aparelhos dedicados por QR e usar `lock task mode` sob um controlador de política do dispositivo. O pacote assinado e o aparelho concreto ainda precisam ser definidos para gerar o QR final.
3. Criar no servidor um canal `autoatendimento` que reutilize catálogo, pedido, cozinha e registro financeiro. O Pix reutiliza a integração Mercado Pago da loja; cartão na Moderninha Smart 2 depende da integração presencial aprovada pelo PagBank. Imprimir somente após confirmação financeira vinculada ao mesmo pedido, com controle de repetição.

Fontes oficiais: [Android — dedicated devices](https://developer.android.com/work/dpc/dedicated-devices), [Android — lock task](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [PagBank — SmartPOS](https://developer.pagbank.com.br/docs/integracao-smartpos-1), [PagBank — FAQ SmartPOS](https://developer.pagbank.com.br/docs/faq-smartpos).

## Validações ainda necessárias

- Aparelho Android que será o terminal, versão do sistema, modo de instalação/provisionamento e conexão USB com a Bematech.
- Impressão de um pedido confirmado, falha/desconexão de USB, retorno da impressora e reimpressão sem duplicar a venda.
- Parceria/homologação PagBank para a Moderninha Smart 2 e o fluxo aprovado para comunicar o resultado ao servidor.
- Pedido real por Pix e pedido real por cartão, observados no terminal, KDS, PDV e extrato do provedor.

## Atualização após a auditoria inicial — 16/11/2026

O KDS web agora chama `AndroidPrint` ao iniciar o preparo, e um novo APK de teste separado do legado foi compilado. O teste USB físico ainda está pendente. Para o cartão no autoatendimento, o plano passou a priorizar Mercado Pago Point via Orders API: o Android não precisa conectar localmente à maquininha. O backend cria a cobrança, recebe e valida o webhook e informa ao terminal o estado persistido do pedido. A Smart 2 do PagBank permanece como alternativa suspensa; o PlugPag Bluetooth documentado não a lista como compatível. Os itens anteriores registram o estado encontrado na data da auditoria, não o estado de produção atual.
