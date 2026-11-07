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

O PDV deve permitir a sequência de teclado **F3 → 1 Dinheiro, 2 Pix ou 3 Cartão → F4**. Em dinheiro, o foco segue para o valor recebido. Em Pix e cartão, segue para finalizar.

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

O monitor do gestor terá somente consultas. O servidor restringirá os dados à loja vinculada e as operações do monitor a leitura. A configuração administrativa da loja fica em uma interface separada do monitor. Caixa e cozinha terão permissões próprias no servidor. A PWA do KDS será validada com uma conta que só tem acesso à cozinha.

A REMO devolverá os estados necessários à loja, incluindo saída para entrega e conclusão. A R Sistemas exibirá esses estados no monitor do gestor a partir do vínculo com o despacho. O acesso à central logística permanece separado.

### Impressão na cozinha

O legado contém o projeto Android DoRafaKDSPrint. O aplicativo carrega o KDS em uma WebView e oferece a ponte PrintBridge com o nome AndroidPrint para comunicação com a impressora USB. A referência de impressora térmica é a Bematech MP-4200 TH. Antes de ativar impressão automática no novo KDS, validar a ponte no telefone com a impressora física, a confirmação de impressão e o controle de reimpressão para evitar duplicatas. A compatibilidade da PWA e a compatibilidade do aplicativo Android são testes separados.

No App do Rafa, os manifestos do cardápio e do KDS ficam no módulo Cardapio. A REMO antiga tem manifesto e service worker na rota principal, cuja interface autentica entregadores e encaminha os demais perfis aos seus portais.

## Infraestrutura e identidade

A REMO é uma única central regional com operação própria. Estabelecimentos integrados e empresas que operam sem o PDV podem solicitar entregas. O cardápio registra o endereço no pedido. No despacho, a integração envia à API da REMO os dados necessários da entrega e uma referência para evitar duplicidade. A REMO mantém sob sua responsabilidade rotas, entregadores, rastreamento e saldo de corridas.

GitHub para o código, Vercel para os aplicativos e Supabase para dados e autenticação. A REMO compartilha infraestrutura inicialmente e mantém operação independente. O cardápio público destaca a marca de cada loja, mostra até três Queridinhos e organiza os produtos em faixas horizontais por categoria. O OSRM fica fora do custo inicial até a necessidade de roteamento viário ser validada.

O painel central da R Sistemas, separado da administração de cada loja, terá gestão de licenças e do espaço publicitário global. O administrador geral poderá publicar até cinco banners, na mesma ordem em todos os cardápios licenciados, para divulgação própria ou de parceiros. As imagens são armazenadas uma vez e referenciadas pelos cardápios. O piloto exclui remarketing, QR de marketing e gestão de anúncios por loja.

A arte de agradecimento após o pedido pertence a cada estabelecimento. O gestor local poderá enviá-la pelo painel da loja. Ela aparece após o envio de um pedido para pagar no caixa ou depois da confirmação de um pagamento online. A tela mantém o andamento do pedido junto da arte. Os detalhes de produto apresentam foto, descrição, composição, quantidade e valor antes de adicionar ao carrinho. Destaques temporários orientam a próxima ação e respeitam a preferência de movimento reduzido do dispositivo.

O upload de fotos de produtos deve oferecer prévia do recorte quadrado, limitar o tamanho de entrada e validar o arquivo. A imagem publicada será uma versão WebP de até 640 × 640 px, com metadados removidos e meta de até 60 KB por foto. A otimização acontece antes de publicar o arquivo. Queridinhos e categorias usam o mesmo cartão e a mesma área quadrada, inclusive quando o produto não tem foto.

A primeira entrega local usa a logo fornecida e aproxima a tipografia com uma fonte de sistema. Os dados são fictícios e persistem apenas no navegador. Antes da produção, substituir essa persistência por operações autenticadas e transacionais no Supabase. Nenhuma etapa da tabela está concluída até a validação em produção.

## Adicionais de comanda — implementação de 7 de novembro de 2026

O PDV permite acrescentar produtos a comandas de mesa já entregues e ainda sem recebimento ou cobrança online. O catálogo permite ocultar produtos do cardápio público e definir se os adicionais precisam de cozinha. Itens de balcão sem preparo entram no mesmo total e podem ser recebidos imediatamente. Os que exigem preparo geram um lote próprio no KDS, com somente as novas quantidades. O recebimento fica bloqueado até a entrega dos lotes. Preços originais são preservados, o servidor calcula os totais e a repetição de uma solicitação não duplica itens nem recebimentos.

Validação transacional com rollback em tests/adicionais-comanda.sql cobre visibilidade pública, preço histórico, repetição, lote de cozinha, item sem preparo, bloqueio de recebimento antecipado, comanda paga e acesso sem vínculo. A inclusão durante o preparo original, adicionais após pagamento com cobrança vinculada e cancelamento com motivo permanecem etapas seguintes. Pix presencial automático também permanece pendente.
