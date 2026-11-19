# Pacote de aprovação · Equipe e terminais da loja

Base `529b896213c52cfaf3592f173b3014374257f411`. Entrega em `codex/painel-equipe`.

## Contratos

- A aba **Equipe e terminais** em `/admin-loja.html` lista membros operadores de vendas, caixas e status do vínculo. Exibe os terminais com identificador, operador e última abertura de turno quando disponível, e permite configurar terminal e nome do PDV. O cadastro exige caixa na nova área. Os caminhos existentes de venda e cozinha do PDV continuam atendidos pela mesma Function.
- `/api/painel-equipe` usa a empresa retornada pelo contexto do Supabase para a sessão autenticada. O seletor ou UUID da URL é apenas uma solicitação de escopo. A RPC invoker verifica novamente o vínculo, preserva as RLS e chama as RPCs legadas de listagem, configuração e remoção. As operações do painel são restritas a operadores da loja; não há gestão de gestores.
- A remoção reusa `remover_operador_loja`. Revoga vínculos da loja, inclusive cozinha quando aplicável, sem excluir a identidade global do Auth, terminais ou histórico. A guarda de turno aberto permanece. Um operador removido deixa de abrir caixa com a sessão já emitida, mesmo que ainda possa autenticar no Auth.
- O cadastro reusa a Function e `vincular_novo_operador_pdv` ou `vincular_novo_usuario_kds`. A tentativa persistida antecede a chamada externa. O resultado de sucesso é atômico com vínculo, terminal e trilhas de tabela. Uma resposta perdida pode ser conciliada pela correlação original. Se o banco rejeitar de forma definitiva o vínculo da conta recém-criada, o fluxo tenta compensar no Auth; se não puder confirmar o estado, registra indeterminação e preserva evidências. O [runbook](PAINEL_CENTRAL_RUNBOOK.md) cobre a reconciliação.

## Migrations

| Versão | Responsabilidade |
| --- | --- |
| `202611190052` | Triggers em membros, terminais, equipe KDS e alteração do nome do PDV. Uma linha por mutação da tabela; empresa, autor e snapshot de campos operacionais. |
| `202611190053` | Registro de tentativa e resultado do cadastro no Auth, com correlação e escrituras de negócio na mesma transação da confirmação. RPCs de coordenação concedidas ao papel de serviço. |
| `202611190054` | RPC invoker da aba, com `search_path` fixo e execução concedida a `authenticated`. |

A consulta prévia em produção foi somente leitura no ref `eyqxxlcmxlilgogxdcoq` e host `eyqxxlcmxlilgogxdcoq.supabase.co`, com ledger 58. A assinatura, o corpo e os grants efetivos das RPCs e tabelas reutilizadas estão na evidência pré-voo. O e-mail do operador aparece nos snapshots e na correlação por ser dado operacional. Senha, token e convite nunca entram no payload de auditoria.

## Homologação

A suíte local usa PostgreSQL 17 descartável, dispatcher HTTP, Auth/PostgREST simulados e Chrome headless. Após autorização para ambiente separado, use JWTs reais de dois gestores, um operador e uma conta recém-cadastrada. Verifique 401 ausente/inválido, 403 cruzado nos dois sentidos e operador, listagem própria, criação via Auth e vínculo, caixa e auditoria correlacionada. Confira a edição do terminal, o timestamp de uso, a remoção com turno fechado e a negação imediata em `abrir_caixa` com o mesmo JWT do operador, preservando a identidade no Auth. Exercite falha injetada de auditoria exclusivamente em ambiente descartável.

Para publicar, as três migrations devem anteceder o deploy, pois o cadastro legado passa a usar as RPCs de coordenação. Nenhuma ação de aplicação, merge ou deploy integra este pacote.
