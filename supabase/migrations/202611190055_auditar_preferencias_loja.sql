begin;

create function painel_privado.auditar_preferencias_loja()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_autor uuid := auth.uid();
  v_antes jsonb;
  v_depois jsonb;
begin
  select
    jsonb_object_agg(a.key,case when a.key in ('cardapio_logo','cardapio_agradecimento')
      then jsonb_build_object('presente',a.value <> 'null'::jsonb) else a.value end),
    jsonb_object_agg(d.key,case when d.key in ('cardapio_logo','cardapio_agradecimento')
      then jsonb_build_object('presente',d.value <> 'null'::jsonb) else d.value end)
  into v_antes,v_depois
  from jsonb_each(to_jsonb(old)) a join jsonb_each(to_jsonb(new)) d using(key)
  where a.key in ('cardapio_cor','cardapio_fundo','cardapio_logo','cardapio_agradecimento',
      'mapa_centro_latitude','mapa_centro_longitude','pagamento_na_entrega')
    and a.value is distinct from d.value;
  if v_antes is null then return null; end if;

  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,antes,depois,requisicao_id)
  values (coalesce(v_autor,'00000000-0000-0000-0000-000000000000'),
    case when v_autor is not null then 'usuario'
      when auth.role()='service_role' or current_setting('role',true)='service_role' then 'servico'
      else 'sistema' end,
    'loja',new.id,'empresas.preferencias','empresas',new.id::text,v_antes,v_depois,gen_random_uuid());
  return null;
end;
$$;

revoke all on function painel_privado.auditar_preferencias_loja() from public,anon,authenticated,service_role;
create trigger auditar_preferencias_loja after update on public.empresas
  for each row when (
    (old.cardapio_cor,old.cardapio_fundo,old.cardapio_logo,old.cardapio_agradecimento,
      old.mapa_centro_latitude,old.mapa_centro_longitude,old.pagamento_na_entrega)
    is distinct from
    (new.cardapio_cor,new.cardapio_fundo,new.cardapio_logo,new.cardapio_agradecimento,
      new.mapa_centro_latitude,new.mapa_centro_longitude,new.pagamento_na_entrega)
  ) execute function painel_privado.auditar_preferencias_loja();

commit;
