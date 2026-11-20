begin;

create function painel_privado.auditar_mesa()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  autor uuid := auth.uid();
  origem text := case when autor is not null then 'usuario'
    when auth.role()='service_role' or current_setting('role',true)='service_role' then 'servico'
    else 'sistema' end;
begin
  insert into painel_privado.auditoria(autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,
    antes,depois,requisicao_id)
  values(coalesce(autor,'00000000-0000-0000-0000-000000000000'),origem,'loja',new.empresa_id,
    case when tg_op='INSERT' then 'mesas.criar' when new.ativo then 'mesas.reativar' else 'mesas.desativar' end,
    'mesas_cardapio',new.numero::text,
    case when tg_op='UPDATE' then jsonb_build_object('ativo',old.ativo) end,
    case when tg_op='UPDATE' then jsonb_build_object('ativo',new.ativo)
      else jsonb_build_object('numero',new.numero,'ativo',new.ativo,'criado_em',new.criado_em) end,
    gen_random_uuid());
  return null;
end;
$$;

revoke all on function painel_privado.auditar_mesa() from public,anon,authenticated,service_role;
create trigger auditar_mesa_criada after insert on public.mesas_cardapio
  for each row execute function painel_privado.auditar_mesa();
create trigger auditar_mesa_situacao after update of ativo on public.mesas_cardapio
  for each row when (old.ativo is distinct from new.ativo) execute function painel_privado.auditar_mesa();

commit;
