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

O Quiosque usa a própria conta Mercado Pago para o Pix padrão em produção, com Asaas como alternativa. A configuração de provedores e meios é por estabelecimento e ambiente. As credenciais privadas ficam no servidor, vinculadas à conta da loja.

O crédito Mercado Pago em 1x foi homologado com pedidos aprovados, pendentes e recusados. O formulário tokenizado está publicado no link específico do piloto. Falta uma compra real para conferir a confirmação pelo webhook, a entrada na cozinha e o valor líquido no extrato. O débito segue separado, pendente de habilitação pelo provedor.

O checkout de entrega deverá solicitar o endereço e apresentar o resumo antes do pagamento. Pagamento online é o padrão. Pagar na entrega fica desativado por padrão e só deve aparecer quando o gestor da loja habilitar a preferência. O servidor deve aplicar a mesma regra ao receber o pedido. Para consumo no local, o QR identifica a mesa e o cliente pode pagar no caixa.

Novas integrações serão adicionadas conforme a demanda das lojas e os meios oferecidos por cada instituição.

## Interfaces e instalação

O acesso ao PDV terá entradas para **Administração** e **Vendas**. A escolha da tela não concede permissões. O servidor valida o perfil e o vínculo com o estabelecimento. Na Administração, o gestor mantém o catálogo, configura o nome exibido no PDV e cadastra caixas identificáveis, como Caixa 01 e Caixa 02, com os operadores autorizados. Em Vendas, o operador entra com a própria conta e abre um caixa autorizado. Cada turno registra o identificador do caixa e do operador. O operador de vendas tem acesso às ações de caixa e venda permitidas pelo seu perfil.

No PDV, **F3** abre as formas de pagamento. **1** seleciona Dinheiro e leva ao valor recebido. **3** seleciona Cartão na maquininha e leva à finalização por **F4** ou **Enter**. **2** inicia o Pix automático e abre o QR Code em uma janela central com o tempo restante e o copia e cola. Após a confirmação do provedor, o caixa registra a venda e o movimento uma única vez e exibe a confirmação, que pode ser fechada por **OK** ou **Enter**. O servidor preenche o e-mail técnico da integração no PDV e no cardápio.

O gestor poderá conceder e revogar a permissão de desconto por operador e estabelecimento. Para aplicar um desconto, o operador autorizado confirma a própria senha no PDV. A autorização vale para aquela venda, com registro do operador e do valor concedido. As demais permissões do perfil permanecem separadas.

Na frente de caixa, a grade central mostra os itens da venda ou da comanda aberta. O catálogo do PDV abre em janela própria, agrupado por categoria. O painel de recebimento muda conforme o meio escolhido. Os estados de Pix aguardando, confirmado e expirado devem vir da cobrança real.

O catálogo da loja será a fonte dos produtos. Uma opção de visibilidade deve permitir itens ativos exclusivamente no PDV. O pedido tem origem identificada como mesa, balcão ou link público e usa o mesmo registro em todas as áreas. O KDS recebe pedidos elegíveis para preparo. O PDV consulta pedidos por número ou mesa quando precisa complementar, receber ou cancelar. A origem pública por si só não exige aceite manual. A entrega usa o despacho da REMO quando aplicável.

Para complementar uma comanda pendente, o PDV deve registrar os itens adicionais no pedido, preservar os preços já confirmados e enviar à cozinha apenas o que ainda precisa de preparo. Após pagamento confirmado, itens adicionais devem ter cobrança separada vinculada à comanda. O cancelamento operacional deve registrar motivo, autor e etapa do pedido. Pedido pendente pode ser cancelado conforme permissão e etapa. Pedido pago exige tratamento financeiro separado, com confirmação do estorno pelo provedor ou lançamento de devolução no caixa.

| Interface | Acesso e operação | Instalação |
| --- | --- | --- |
| Cardápio | Vitrine pública por estabelecimento, pedido e acompanhamento. O link ou QR de mesa determina o contexto da compra. | PWA própria do cardápio, instalável pelo cliente. |
| PDV | Portal web do caixa, com vendas, recebimentos e abertura e fechamento de caixa. | Acesso pelo navegador no computador. |
| KDS | Tela exclusiva da cozinha. A equipe vê apenas pedidos da sua loja e executa as transições de preparo permitidas. | PWA própria para o telefone da cozinha. |
| Monitor do gestor | Tela móvel de consulta dos pedidos, recebimentos, saídas para entrega e entregas concluídas. O gestor entra com a conta da loja e pode manter a sessão no dispositivo. | PWA própria do monitor. |
| REMO | Central logística com interface e permissões próprias. | Portal web nesta fase. PWA do entregador em fase posterior. |

O monitor do gestor oferece somente consultas e tem PWA própria em `/monitor.html`. A conta de gestor vê os estabelecimentos aos quais está vinculada e acompanha por dia os pedidos, o bruto recebido no caixa e online e os estados de entrega da REMO. O monitor mantém a sessão em cookies restritos ao seu endpoint e atualiza enquanto a tela está visível. Configuração da loja, caixa e cozinha têm interfaces separadas.

A REMO é a fonte do estado da entrega. Cardápio, PDV, KDS e monitor consultam o vínculo com o despacho. A central registra a saída e a conclusão. A cozinha prepara o pedido e encerra sua fila de trabalho quando a entrega foi concluída. Quando o pagamento é na entrega, concluir a corrida mantém o recebimento pendente até seu registro.

### Impressão na cozinha

O legado contém o projeto Android DoRafaKDSPrint. O aplicativo carrega o KDS em uma WebView e oferece a ponte PrintBridge com o nome AndroidPrint para comunicação com a impressora USB. A referência de impressora térmica é a Bematech MP-4200 TH. Antes de ativar impressão automática no novo KDS, validar a ponte no telefone com a impressora física, a confirmação de impressão e o controle de reimpressão para evitar duplicatas. A compatibilidade da PWA e a compatibilidade do aplicativo Android são testes separados.

No App do Rafa, os manifestos do cardápio e do KDS ficam no módulo Cardapio. A REMO antiga tem manifesto e service worker na rota principal, cuja interface autentica entregadores e encaminha os demais perfis aos seus portais.

## Infraestrutura e identidade

A REMO é uma única central regional com operação própria. Estabelecimentos integrados e empresas que operam sem o PDV podem solicitar entregas. O cardápio registra o endereço no pedido. No despacho, a integração envia à API da REMO os dados necessários da entrega e uma referência para evitar duplicidade. A REMO mantém sob sua responsabilidade rotas, entregadores, rastreamento e saldo de corridas.

O fluxo integrado foi validado na aplicação publicada com loja fictícia e Pix Mercado Pago Sandbox. O teste cobriu cardápio, preparo em conta exclusiva do KDS, despacho pelo PDV sem duplicação, aceite, saída, conclusão e retorno automático ao cardápio e ao monitor. A operação por empresa externa ainda precisa de cadastro e abertura de corrida próprios. Atribuição a entregador, cotação, rastreamento e saldo por corrida ainda precisam ser implementados e homologados.

GitHub para o código, Vercel para os aplicativos e Supabase para dados e autenticação. A REMO compartilha infraestrutura inicialmente e mantém operação independente. O cardápio público destaca a marca de cada loja, mostra até três Queridinhos e organiza os produtos em faixas horizontais por categoria. O OSRM fica fora do custo inicial até a necessidade de roteamento viário ser validada.

O painel central da R Sistemas, separado da administração de cada loja, terá gestão de licenças e do espaço publicitário global. O administrador geral poderá publicar até cinco banners, na mesma ordem em todos os cardápios licenciados, para divulgação própria ou de parceiros. As imagens são armazenadas uma vez e referenciadas pelos cardápios. O piloto exclui remarketing, QR de marketing e gestão de anúncios por loja.

A arte de agradecimento após o pedido pertence a cada estabelecimento. O gestor local poderá enviá-la pelo painel da loja. Ela aparece após o envio de um pedido para pagar no caixa ou depois da confirmação de um pagamento online. A tela mantém o andamento do pedido junto da arte. Os detalhes de produto apresentam foto, descrição, composição, quantidade e valor antes de adicionar ao carrinho. Destaques temporários orientam a próxima ação e respeitam a preferência de movimento reduzido do dispositivo.

O upload de fotos de produtos deve oferecer prévia do recorte quadrado, limitar o tamanho de entrada e validar o arquivo. A imagem publicada será uma versão WebP de até 640 × 640 px, com metadados removidos e meta de até 60 KB por foto. A otimização acontece antes de publicar o arquivo. Queridinhos e categorias usam o mesmo cartão e a mesma área quadrada, inclusive quando o produto não tem foto.

A primeira entrega local usa a logo fornecida e aproxima a tipografia com uma fonte de sistema. Os dados são fictícios e persistem apenas no navegador. Antes da produção, substituir essa persistência por operações autenticadas e transacionais no Supabase. Nenhuma etapa da tabela está concluída até a validação em produção.

## Adicionais de comanda — implementação de 7 de novembro de 2026

O PDV permite acrescentar produtos a comandas de mesa já entregues e ainda sem recebimento ou cobrança online. O catálogo permite ocultar produtos do cardápio público e definir se os adicionais precisam de cozinha. Itens de balcão sem preparo entram no mesmo total e podem ser recebidos imediatamente. Os que exigem preparo geram um lote próprio no KDS, com somente as novas quantidades. O recebimento fica bloqueado até a entrega dos lotes. Preços originais são preservados, o servidor calcula os totais e a repetição de uma solicitação não duplica itens nem recebimentos.

Validação transacional com rollback em tests/adicionais-comanda.sql cobre visibilidade pública, preço histórico, repetição, lote de cozinha, item sem preparo, bloqueio de recebimento antecipado, comanda paga e acesso sem vínculo. Adicionais após pagamento com cobrança vinculada permanecem uma etapa futura.

O Pix automático do Quiosque cobre vendas de balcão e comandas de mesa entregues. O caixa pode retomar uma cobrança aberta após entrar novamente. Uma nova cobrança pode ser gerada após o Mercado Pago confirmar o cancelamento ou a expiração da anterior. A validação incluiu confirmação de balcão e comanda no Sandbox, emissão, retomada e cancelamento de um QR de produção e um recebimento real de R$ 0,50 em 7 de novembro de 2026, conciliado com uma venda e um movimento de caixa.

## Pendências de infraestrutura — registro de 24 de novembro de 2026

**Identidade de e-mail (GATILHO: domínio personalizado).** Os e-mails transacionais do Supabase usam o remetente padrão da plataforma. Quando o domínio personalizado da R Sistemas for comprado e configurado ( Sites/Vercel + DNS ), executar nesta ordem: (1) verificar DNS do domínio; (2) configurar SMTP próprio no Supabase Auth (provedor com free tier, ex.: Brevo/Resend); (3) aplicar os 13 templates pt-BR preparados em `supabase/templates/`; (4) verificar SPF/DKIM/DMARC do domínio de envio; (5) homologar entrega real de convite, recuperação de senha e notificação de licença. Auditorias futuras devem verificar se o domínio já existe e acionar este bloco automaticamente.

**Asaas — descontinuado.** Abandonado pelo proprietário em 23/11/2026 por taxas abusivas de Pix. Webhook "RSistema Pix Kiosk" removido do painel pelo proprietário. Remoção do código é incremento separado em fila, condicionada à prova de que nenhuma empresa o utiliza em `provedores_pagamento`. **PagBank é o PSP alternativo preferido** para avaliação futura (pesquisar se simplificou API/onboarding como o Mercado Pago fez).

**Convite para empresa existente.** O fluxo de convite da Central só atende cadastro de nova empresa. Registrar gestor adicional em empresa existente é pendência conhecida — necessária para o futuro onboarding self-service e segundo gestor/sócio.

**Credenciais MP — limitações do piloto.** O formulário do gestor grava apenas `producao` (sandbox hoje só via API direta). Troca de recebedor aprovada pela Central ainda não exige validação automática de webhook — no piloto é procedimento operacional; tornar automático é requisito do onboarding self-service. ID do vendedor de teste MP (`3095871690`) está fixado em código e banco — deve virar configuração quando houver múltiplas contas de teste.

**Limite Vercel Hobby.** 12 funções serverless por deployment. Novas rotas em `api/` exigem consolidação prévia via rewrites (padrão já estabelecido). Reavaliar Vercel Pro quando houver clientes reais.

**UX mobile — observações do teste de pedido (24/11/2026).** (1) Tela de pagamento Pix no celular não oferece botão "Copiar código Pix" com feedback — hoje o cliente precisa selecionar o código manualmente; adicionar botão de cópia com confirmação visual. (2) Ao avançar entre etapas (ex.: localização → forma de pagamento), a tela mantém a posição de scroll anterior; cada nova etapa deve iniciar rolagem no topo. Prioridade: antes de abrir cardápio público para clientes reais.

**UX PDV/frente de caixa — observações do teste real (24/11/2026).** (1) Pedido pago online não aparece no bloco de pagamentos sem F5 — implementar atualização automática (polling ou realtime) do bloco de pedidos online. (2) Bloco "Pagamentos online da loja" fica no fim da página — deve ser a primeira informação visível no PDV; renomear para "Pedidos online". (3) Layout do PDV deve voltar ao modelo App do Rafa: tela cheia, funções como botões que abrem painéis/modais (movimentação de caixa, histórico de caixa, acertos de entregas, cozinha) em vez de blocos empilhados com scroll; evitar navegação acidental por endereço. Prioridade: antes de operação com operadores reais.

**UX pedido online — teste E2E real com entrega REMO (24/11/2026).** Fluxo completo validado: cardápio mobile → Pix → "pagamento confirmado" → em preparo → KDS/cozinha → pronto → despacho REMO automático → Central Logística → entregador Bruno aceita/inicia/entrega → sem acertos pendentes. Pontos a melhorar: (1) página de status do cliente mostra transições de forma discreta demais — "em preparo" passou despercebido; criar indicador de etapa bem visível (stepper/progresso com destaque, ex.: Recebido → Em preparo → Pronto → A caminho → Entregue). (2) Tela do entregador REMO mostra "confirmar entrega e cobrança" — ambíguo, sugere cobrança ao cliente que não existe (pedido já pago online); separar conceitos: "Confirmar entrega" apenas, cobrança só quando aplicável (pagamento na entrega). (3) Status do pedido no celular atualizou o despacho automaticamente — bom; manter realtime em todas as transições.

**Notificação de status do pedido (24/11/2026).** No teste E2E não houve nenhum aviso no telefone do cliente quando o despacho foi solicitado — a página de status só atualiza visualmente para quem está com ela aberta. Implementar: (1) mínimo — alerta visual/sonoro na página de status quando a etapa mudar com a aba aberta; (2) ideal — Web Push via service worker do PWA para avisar mesmo com o app fechado ("seu pedido saiu para entrega", "entregador a caminho", "pedido entregue"). Prioridade alta para operação com entrega — cliente não pode depender de ficar olhando a tela.

**App nativo entregador REMO + KDS (decisão do proprietário, 24/11/2026).** Web Push falhou de forma recorrente e estrutural: permissão ativa, app fechado, notificação não entregue — limite do Web Push no Android sob economia de bateria dos fabricantes. Solução: app híbrido (Capacitor ou nativo) com Firebase Cloud Messaging para notificações confiáveis com app fechado. Ordem: (1) REMO entregadores primeiro — despacho/ofertas são vitais à Central Logística; (2) KDS cozinha depois — atraso de notificação de pedido = atraso de preparo = atraso de entrega. Distribuição por APK sideload com link; Play Store como fallback se necessário. Notificações devem cobrir: nova corrida/oferta, mudança de status da corrida, mensagens da central. Incremento próprio, após fechamento do 4A.

## Administração Central 4A — concluído com ressalva

Pix conciliado no sandbox e no quiosque em produção, com trilha financeira. Assinatura inválida rejeitada e ORDTST ignorada em produção. A simulação cruzada sandbox → quiosque retornou HTTP 502 sem alterar ordens ou eventos. A prova de isolamento financeiro com **duas contas Mercado Pago de produção de CNPJs distintos** é critério obrigatório de aceite no onboarding da segunda loja. O teste deve comprovar recebedores distintos e rejeição ou descarte de notificações da conta A sobre pedidos da conta B, sem efeito no pagamento ou na trilha financeira.

**Clientes pessoa física (PF) — decisão de produto (24/11/2026).** Conta Mercado Pago pessoa física é caso de cliente válido: autônomos e vendedores sem CNPJ/MEI. Encaixa no plano Básico (sem emissão fiscal). Verificar no código se algum fluxo exige CNPJ (cadastro de empresa, checkout, licenciamento) e flexibilizar para CPF/não informado. A obrigação fiscal municipal do cliente PF é responsabilidade dele — levantar com o contador na reunião de alinhamento fiscal; pode virar material de orientação comercial. Conta PF da esposa do proprietário servirá como segunda conta MP de produção para a prova final de isolamento do 4A (duas contas reais distintas) e homologação do cenário PF.

**Cobrança de licença — Incremento 4 v2.0 (27/11/2026).** A Fase 2 teve a implementação local auditada e aprovada, incluindo o ajuste de limites. A [especificação v2.0](_arquivo_morto/painel-evidencia-historico/incremento-admin-central-4/DECISOES_INCREMENTO_4_V2.0.md) continua a referência. A janela atual autoriza a publicação do código com as funcionalidades dormentes. As migrations 101–112 ficam pendentes de uma janela de banco. A homologação segue aberta para Cron/Vault, webhook autêntico do Mercado Pago, e-mail, tarifas e prazos da conta real, `live_mode` e expiração natural do QR em 30 minutos. [Evidências e reversão](_arquivo_morto/painel-evidencia-historico/incremento-4/FASE-2-CONTINUACAO.md) · [Ajuste de limites](_arquivo_morto/painel-evidencia-historico/incremento-4/AUDITORIA-LIMITES-FASE-2.md).

### INCREMENTO-LOGIN-MULTILOJA — prioridade alta

Pré-requisito do modelo multiloja completo. O cadastro de operador sempre cria uma conta no Supabase Auth. Uma conta existente não pode ser vinculada à segunda loja pelo painel, embora o banco aceite vínculos por empresa e usuário.

Desenhar convite com aceite para vincular a conta existente, preservando senha e acessos atuais. Decidir com evidência entre sessão única com empresa explícita e autenticação própria por loja para operadores. A investigação do erro de terminal é independente.
