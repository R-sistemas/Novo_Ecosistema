# Login multiempresa · Fase 1 B02

## Decisões do proprietário

Esta fase cobre a equipe no painel e no PDV. A Central e a REMO têm fases próprias. A conta Supabase Auth continua identificando a pessoa. O gestor emite o convite da loja. O titular usa a senha da própria conta ou conclui a confirmação do Auth conforme a configuração vigente. A fase dispensa um desafio adicional de posse do e-mail. O link pode ser copiado ou compartilhado pelo WhatsApp. A interface só exibe o segredo na emissão ou no reenvio. Se o gestor carregar a tela novamente, Reenviar gera outro link e invalida o anterior.

Na decisão posterior de reautenticação, o proprietário aprovou a opção A. O seletor do PDV pede a senha em toda troca de loja já aberta, inclusive A→B→A. A exigência reduz erro operacional em terminal compartilhado. O servidor continua validando identidade, vínculo vigente, terminal e empresa do recurso. A eventual adoção de prova de reautenticação por loja e aba no servidor fica para avaliação após o piloto.

## Antes da janela

1. Auditar o SHA canônico no manifesto e conferir os SHA-256 dos blobs SQL. O último registro de produção consultado no pacote B04/B05 documenta 101 versões e termina em `202611250094`. Em leitura, reconciliar novamente o ledger, os membros, os vínculos KDS, os terminais, os turnos abertos, as lojas de gestor único e as configurações do Auth para as lojas do piloto. Guardar apenas totais ou identificadores técnicos no comparativo.
2. Confirmar cadastro e confirmação de novas contas com as configurações do Auth vigentes. O fluxo de inscrição usa o destino fixo `/convite-equipe.html` na mesma origem. Verificar o destino permitido no Supabase antes de habilitar e exercitar o cadastro com o remetente disponível. O link de convite independe de SMTP. O cadastro de uma conta nova segue a configuração de confirmação do provedor.
3. Sob ordem separada do proprietário, aplicar as migrations na ordem abaixo. Registrar cada versão no ledger junto com sua aplicação e conferir o catálogo antes de publicar o código. Com base em 101 versões, os totais esperados são 102, 103 e 104. Investigar qualquer diferença entre o ledger observado e a base da auditoria.

| Versão | Efeito |
| --- | --- |
| `202611250095` | Convites, idempotência, auditoria e tabelas privadas. Emissão e aceite começam desligados. |
| `202611250096` | Revisão de vínculo, suspensão local e fechamento assistido. Preserva caixas, operadores históricos, vendas e movimentos. |
| `202611250097` | Ativação e reversão explícitas por loja. As lojas que entram no piloto deixam de usar o cadastro legado. |

4. Após a publicação autorizada, conferir o SHA do deployment e a leitura com as lojas do piloto ainda desativadas. Comparar um usuário de uma loja e um gestor com mais de uma. Atualizar o painel e o PDV no navegador e nas PWAs antes de conceder o segundo vínculo. Fazer o piloto com contas controladas do painel/PDV. Se o titular também operar em KDS ou Monitor, confirmar a compatibilidade desses caminhos antes de conceder acesso múltiplo àquela superfície.
5. Em conexão administrativa autorizada, habilitar apenas os UUIDs aprovados. Começar com duas lojas de teste e um único titular controlado.

```sql
select painel_privado.configurar_convites_equipe(array['<uuid-loja-a>','<uuid-loja-b>']::uuid[],true);
```

6. Emitir e aceitar o convite de B com a conta já usada em A. Conferir que o mesmo UUID e a mesma senha continuam funcionando, que A e B exibem apenas a operação correspondente e que uma nova aba pode permanecer em B enquanto A é suspensa. Testar conta nova, reenvio, cancelamento, link vencido, recuperação e fechamento assistido com caixa aberto. Conferir trilha e negações do servidor antes de ampliar. As autorizações vigentes são consultadas ao receber 401/403, quando a aba retorna e em consulta periódica a cada cinco segundos com a aba ativa.

## Reversão

Desligar emissão, reenvio e aceite nas lojas afetadas, mantendo os registros de convite, os vínculos aceitos e a auditoria.

```sql
select painel_privado.configurar_convites_equipe(array['<uuid-loja-a>','<uuid-loja-b>']::uuid[],false);
```

A versão de reversão permanece compatível com a escolha de múltiplas lojas. O registro por loja impede reabrir o cadastro legado após adesão ao piloto. Pendências podem ser canceladas pelo gestor. As suspensões e os fechamentos assistidos permanecem disponíveis. Em caixa com Pix em aberto, vale o bloqueio existente até a conciliação ou expiração do provedor. A ação assistida registra o gestor e conserva o operador original no turno. Se uma restauração excepcional de dados for necessária, reconciliar a trilha e obter ordem explícita para a operação.

Os registros de convite e a trilha são privados. A equipe da loja consulta apenas os dados operacionais daquela loja. A retenção de produção deve ser registrada na janela autorizada antes de ativar o piloto, junto com os responsáveis pelo acesso administrativo à trilha.
