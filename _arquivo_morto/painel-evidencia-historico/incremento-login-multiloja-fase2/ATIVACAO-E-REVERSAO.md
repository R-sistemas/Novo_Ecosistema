# Fase 2 B03 · Ativação e reversão

## Antes da janela

O pré-voo confirmou 104 versões em produção. Conferir novamente o ledger e os SHA-256 do manifesto antes da janela. As migrations 098, 099 e 100 têm ordem obrigatória. Aplicar somente com autorização. Partindo de 104, esperar 107 versões após a aplicação.

As migrations preservam o onboarding legado como modo inicial. Após publicar ambas as superfícies no SHA auditado, comparar licenças, empresas e vínculos concluídos com o inventário de pré-voo. O gatilho legado só alcança intenções legadas, cujo vínculo ainda está pendente. Destinatários que já receberam um token utilizam a página legada. Repetir a requisição original desse onboarding continua permitido. Novas requisições legadas são bloqueadas após o corte. O recurso da Fase 2 tem configuração independente da flag de Equipe.

## Redirecionamento do Supabase Auth

A página de aceite reutiliza o cadastro da Fase 1 com callback explícito na mesma origem, `https://novo-ecossistema.vercel.app/convite-equipe.html`. O segredo permanece no link original. Após confirmar a conta pelo Auth, reabrir o link original e entrar com a senha criada para aceitar.

O pré-voo registrou o caso de retorno a localhost. Em janela autorizada, revisar a configuração do Auth do projeto vinculado. A Site URL deve ser `https://novo-ecossistema.vercel.app`. Incluir a URL exata da página de convite em Redirect URLs e preservar destinos legítimos já cadastrados, inclusive a ativação legada da Central. Conferir que o template de confirmação respeita o destino autorizado. Validar a URL final da confirmação em um ensaio controlado antes de homologar a conta nova. Se o destino ainda for localhost, parar esse teste até corrigir a configuração.

A regressão local usa Auth simulado. A configuração de produção fica para a janela autorizada.

## Piloto

Com o ledger e os deploys conferidos, usar a ação administrativa abaixo para passar ao fluxo novo.

```sql
select painel_privado.configurar_onboarding_multiempresa(true);
```

Somente agente com capacidade central.empresas.gerir e AAL2 cria empresa ou reenvia convite. Copiar o link na confirmação ou gerar outro na ficha. Se a resposta de criação se perder, repetir a requisição devolve a mesma empresa. A ficha permite gerar outra geração do link. O painel local confirma que o mesmo titular administra A e B e que o aceite não concede acesso de plataforma.

## Reversão

```sql
select painel_privado.configurar_onboarding_multiempresa(false);
```

O modo pausado fecha novas criações, emissões, reenvios e aceites da Fase 2 e permite consultar ficha e histórico. Destravamento de novos fluxos usa o mesmo comando de ativação. O modo legado não é reaberto após o corte. Conservar as empresas, licenças, convites, vínculos e trilha. Preservar os clientes que já entendem múltiplas lojas e as rotas para tokens legados em trânsito.
