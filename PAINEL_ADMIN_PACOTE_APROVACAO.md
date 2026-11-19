# Pacote de aprovação · Frente 4 · Incremento 1

## Etapa 4a · Arquitetura

O commit `bcec81a` em `codex/design-painel` atualiza o documento aprovado em `527e4bf`. As bases são R Sistemas `b8a1a5c` e REMO `31f9e62`. O documento registra o PDV modular como dependência resolvida, as Etapas 1 a 3 em produção e aponta para os módulos do Cardápio, Monitor, checkout e REMO. O incremento 1 fica limitado à base de sessão, autorização e auditoria.

## Etapa 4b · Auditoria em produção

A [consulta ao catálogo](tests/painel-catalogo-producao.sql) foi executada em transação somente leitura no Supabase de produção. A [evidência](tests/painel-catalogo-producao.json) contém tipos de colunas, restrições, grants por tabela e coluna, políticas RLS, assinaturas, permissões e hashes das definições das RPCs. O levantamento acessou metadados e o histórico de migrations.

- **Histórico versus schema.** A base `b8a1a5c` contém 36 versões sem registro remoto. Entre elas estão as versões que definem a lista de operadores, terminais, cancelamentos e o Monitor, cujos contratos constam no catálogo. O grant de `UPDATE(total_centavos)` para `service_role` consta no catálogo, embora a versão `202611160001` esteja ausente do histórico.
- **Assinaturas e grants.** O snapshot `202611170046` também está ausente do histórico. Os sete contratos reconciliados já são efetivos em produção, com parâmetro de frete `bigint` e `EXECUTE` só para o proprietário e `service_role`. Os três overloads antigos de cinco ou quatro argumentos descritos no snapshot estão ausentes do catálogo. Os 32 corpos comparados coincidem com a última definição versionada de cada nome consultado, após normalizar espaços. Assinaturas e grants efetivos constam separadamente na evidência.
- **RLS.** As 16 tabelas têm RLS habilitada. `membros` permite ao autenticado ler o próprio vínculo. `empresas` filtra pelo vínculo. `produtos` permite leitura de membro e escrita de gestor na empresa. `pedidos_online` permite leitura de membro, condição mais ampla que a autorização administrativa. `pagamentos_online`, as tabelas REMO consultadas e as trilhas operacionais têm RLS sem política de acesso direto de aplicação. As três tabelas de projeção, despacho e acerto ficam no schema `remo` do banco de R Sistemas.
- **Limite da comparação.** O catálogo comprova metadados e correspondência dos corpos consultados. Os testes funcionais de autorização usam fixtures sintéticas em banco local.

## Base proposta

- `202611180047` cria papéis, capacidades e vínculos centrais privados e a RPC `painel_contexto_sessao(uuid)` com execução concedida a `authenticated`. A RPC deriva a identidade de `auth.uid()`, checa vínculo de gestor pelo UUID da empresa e exige capacidade central vigente para o contexto de plataforma.
- A atribuição inicial da sessão de loja decorre do vínculo de gestor que já existe em `membros`. Essa escolha cobre as lojas existentes e futuras, mantém uma única fonte de verdade e torna a revogação efetiva na próxima requisição. Nenhuma conta recebe papel central automaticamente. O papel central inicial só resolve o contexto de sessão.
- `202611180048` cria a trilha privada append-only para ações administrativas futuras. A aplicação fica sem grants de leitura ou escrita nessa tabela. O trigger rejeita `UPDATE`, `DELETE` e `TRUNCATE`. O incremento é de leitura e a trilha fica pronta para a primeira mutação administrativa auditada em transação própria.
- `GET /api/painel-sessao?empresa_id=<uuid>` consulta a loja. A mesma rota sem o parâmetro consulta a central. A Function reutiliza o Supabase Auth e encaminha apenas o JWT do usuário com a chave pública `SUPABASE_ANON_KEY`. A rota reutiliza a Function de cadastro via rewrite e preserva a quantidade de Functions. São necessários `SUPABASE_URL` e `SUPABASE_ANON_KEY` no ambiente aprovado antes de publicar.

## Validação e liberação

`node --test tests/painel-sessao.mjs`, com `@electric-sql/pglite` instalado localmente ou indicado em `PAINEL_PGLITE_MODULE`, executa a rota pelo despacho do rewrite, simula o transporte Auth/PostgREST e usa PostgreSQL embarcado para a RPC e os grants. **4/4 testes passaram.** A matriz inclui gestores A e B, troca de UUID nos dois sentidos, sessão ausente e inválida, operador, acesso central com capacidade, capacidade removida, vínculo revogado, chamada direta da RPC e proteção da trilha. O teste aplica as duas migrations propostas sobre a migration versionada que define empresas e vínculos.

Para o próximo passo, aprovar a publicação e reconciliar o histórico remoto antes de executar as duas migrations selecionadas. O lote histórico contém objetos e efeitos já existentes no catálogo. Em homologação com Supabase e Vercel, validar JWTs reais de duas lojas e a propagação dos códigos 401/403 pela rota publicada. O incremento preserva os fluxos operacionais existentes. A entrega está em checkout local para revisão.
