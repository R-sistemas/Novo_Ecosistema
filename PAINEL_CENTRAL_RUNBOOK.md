# Runbook · Primeiro papel central do painel

## Finalidade

Conceder uma única vez o papel `central` a uma conta indicada e aprovada. O modelo atual entrega somente `central.sessao`. A operação é administrativa, em sessão de banco privilegiada e supervisionada. As superfícies públicas continuam oferecendo apenas a consulta de contexto autenticada.

## Pré-condições

1. Abra um registro de mudança com finalidade, projeto e ambiente, identificador da conta beneficiária, operador nominal, aprovador independente e UUID de correlação. Confirme o ref e host no dashboard com o aprovador. Registre horário previsto e janela de revogação, quando aplicável.
2. Use uma conta operacional nominal e uma sessão privilegiada de duração limitada, sob controle do responsável. Confirme a identidade do executor por canal independente e seu UUID existente em `auth.users`. A conta beneficiária deve ser pessoal, ativa, verificada e distinta do executor. Confirme o MFA conforme a política da organização. Nenhuma senha ou JWT integra a evidência.
3. Em leitura, confirme as assinaturas, grants e RLS; o papel `central`; seu único mapeamento para `central.sessao`; e a existência da conta beneficiária. Confira o inventário de vínculos centrais. Se já houver um vínculo central, este procedimento de primeiro provisionamento não se aplica. Identifique as rotinas de leitura e o registro de auditoria que serão verificados. Combine o procedimento de revogação antes de iniciar.

## Concessão controlada

1. Abra uma única transação, adquira bloqueio de escrita em `painel_privado.vinculos_centrais` e repita as precondições sensíveis a concorrência. Limite os tempos de espera e de execução. Caso o papel, a capacidade ou a conta tenham mudado, reverta e preserve o registro de mudança.
2. Insira exatamente um vínculo em `painel_privado.vinculos_centrais` para o UUID aprovado, papel `central`. Confirme que o vínculo foi criado por esta execução. Qualquer repetição deve ser tratada como verificação de estado, sem novo vínculo ou auditoria enganosa.
3. Na mesma transação, insira um evento em `painel_privado.auditoria`. Use `autor_id` do executor nominal verificado, `origem_autor=usuario` quando a coluna estiver disponível, `escopo=plataforma`, empresa nula, ação `central.conceder_primeiro_papel`, entidade `vinculo_central` e entidade identificada pelo UUID da conta beneficiária. O estado anterior é nulo e o posterior contém somente o papel. Use o UUID de mudança como `requisicao_id` e uma justificativa sanitizada. A trilha é obrigatória até durante o provisionamento manual.
4. Confirme exatamente um vínculo e um evento da operação dentro da transação. Se uma escrita, precondição ou a auditoria falhar, reverta a transação inteira. Só confirme as duas mudanças juntas.

## Verificação e revogação

- Teste com JWT da conta concedida. `GET /api/painel-sessao` sem `empresa_id` deve retornar escopo central e a capacidade `central.sessao`. Uma conta sem a concessão deve receber 403 no escopo central. A concessão não cria vínculo de loja. Registre somente os status, a correlação e o horário.
- Para reverter após o commit, reabra uma mudança aprovada. Em uma única transação, bloqueie a tabela, remova somente o vínculo exato criado por este procedimento e grave `central.revogar_primeiro_papel` na trilha. Registre o ator atual, o vínculo anterior, estado posterior nulo e a correlação da revogação. Preserve o evento original. Se o vínculo ou o registro divergirem, interrompa para auditoria.
- Comprove 403 na próxima requisição central da conta revogada e confirme em leitura o evento de revogação. Termine a sessão de operação privilegiada e feche o registro de mudança.
