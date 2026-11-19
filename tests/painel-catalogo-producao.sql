begin read only;
with alvo_t(s,n) as (values
 ('public','empresas'),('public','membros'),('public','produtos'),('public','pedidos_online'),
 ('public','vendas'),('public','itens_venda'),('public','movimentos_caixa'),('public','pagamentos_online'),
 ('public','caixas'),('public','terminais_pdv'),('public','equipe_kds'),('public','ajustes_comanda'),('public','cancelamentos_comanda'),
 ('remo','acertos_entrega'),('remo','solicitacoes'),('remo','tentativas_despacho')
), alvo_f(n) as (values
 ('monitor_gestor'),('alertas_saldo_remo'),('comandas_pendentes'),('comandas_para_cancelar'),
 ('solicitar_cancelamento_comanda'),('resolver_cancelamento_comanda'),('ver_cardapio'),('recebimentos_online_da_loja'),
 ('listar_operadores_gestor'),('remover_operador_loja'),('listar_terminais_gestor'),('configurar_terminal_pdv'),
 ('configurar_edicao_kds'),('vincular_novo_usuario_kds'),('vincular_novo_operador_pdv'),
 ('configurar_aparencia_cardapio'),('configurar_nome_pdv'),('configurar_mesa_cardapio'),
 ('configurar_pagamento_na_entrega'),('pagamento_na_entrega_disponivel'),('metodos_checkout_publico'),
 ('foto_publica_cardapio'),('acertos_entrega_pendentes'),('confirmar_acerto_entrega'),('registrar_acerto_entrega'),
 ('enviar_pedido_pagamento_na_entrega'),('enviar_pedido_pagamento_na_entrega_com_frete'),
 ('reservar_credito_entrega_frete_quiosque'),('reservar_pix_entrega_frete_quiosque'),
 ('reservar_pix_entrega_frete_teste'),('reservar_pix_entrega_quiosque'),('reservar_pix_entrega_teste')
), rel as (
 select a.*, c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity
 from alvo_t a left join pg_namespace ns on ns.nspname=a.s
 left join pg_class c on c.relnamespace=ns.oid and c.relname=a.n
)
select 'tabela' as tipo, s||'.'||n as contrato,
 jsonb_build_object('existe',oid is not null,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl,
 'colunas',(select jsonb_object_agg(attname,format_type(atttypid,atttypmod)) from pg_attribute where attrelid=rel.oid and attnum>0 and not attisdropped),
 'grants_colunas',(select jsonb_object_agg(attname,attacl) from pg_attribute where attrelid=rel.oid and attnum>0 and not attisdropped and attacl is not null),
 'restricoes',(select jsonb_object_agg(conname,pg_get_constraintdef(con.oid)) from pg_constraint con where conrelid=rel.oid),
 'politicas',(select jsonb_agg(to_jsonb(pol)-'schemaname'-'tablename') from pg_policies pol where schemaname=rel.s and tablename=rel.n)) as evidencia
from rel
union all
select 'rpc', a.n, jsonb_build_object('existe',p.oid is not null,'argumentos',pg_get_function_arguments(p.oid),
 'retorno',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,
 'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
 'service_role',has_function_privilege('service_role',p.oid,'execute'),'definicao_md5',md5(pg_get_functiondef(p.oid)), 'corpo_normalizado_md5',md5(regexp_replace(p.prosrc,'\s+','','g')))
from alvo_f a left join pg_proc p on p.proname=a.n and p.pronamespace='public'::regnamespace
union all
select 'historico', 'supabase_migrations.schema_migrations',
 jsonb_build_object('versoes',jsonb_agg(version order by version))
from supabase_migrations.schema_migrations
order by tipo, contrato;
rollback;
