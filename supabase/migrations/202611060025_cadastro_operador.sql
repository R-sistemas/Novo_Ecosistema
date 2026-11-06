begin;

create function public.vincular_novo_operador_pdv(p_gestor uuid, p_empresa uuid, p_operador uuid, p_caixa text)
returns uuid language plpgsql set search_path = '' as $$
declare v_caixa uuid;
begin
  perform 1 from public.membros where empresa_id = p_empresa and usuario_id = p_gestor
    and papel = 'gestor' for share;
  if not found then raise exception 'Acesso administrativo indisponível.' using errcode = '42501'; end if;
  insert into public.membros(empresa_id,usuario_id,papel) values (p_empresa,p_operador,'operador');
  if p_caixa is not null then
    insert into public.terminais_pdv(empresa_id,nome,operador_id)
      values (p_empresa,p_caixa,p_operador) returning id into v_caixa;
  end if;
  return v_caixa;
end;
$$;

revoke execute on function public.vincular_novo_operador_pdv(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.vincular_novo_operador_pdv(uuid,uuid,uuid,text) to service_role;

commit;
