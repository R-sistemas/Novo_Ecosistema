begin;

create function public.painel_equipe(p_empresa uuid,p_acao text,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_resultado jsonb;
  v_email text := lower(btrim(p_dados->>'email'));
begin
  if p_empresa is null then raise insufficient_privilege; end if;
  perform public.painel_contexto_sessao(p_empresa);
  if p_acao='listar' then
    select jsonb_build_object(
      'operadores',coalesce((select jsonb_agg(to_jsonb(o) order by o.email)
        from public.listar_operadores_gestor(p_empresa) o where o.vendas),'[]'::jsonb),
      'terminais',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('ultimo_uso',(
        select max(c.aberto_em) from public.caixas c where c.empresa_id=p_empresa and c.terminal_id=t.id
      )) order by t.nome,t.id) from public.listar_terminais_gestor(p_empresa) t),'[]'::jsonb),
      'nome_pdv',(select e.nome_pdv from public.empresas e where e.id=p_empresa)
    ) into v_resultado;
    return v_resultado;
  end if;
  if p_acao in ('remover','terminal') and not exists(
    select 1 from public.listar_operadores_gestor(p_empresa) o where o.vendas and lower(o.email)=v_email
  ) then raise insufficient_privilege; end if;
  case p_acao
    when 'remover' then perform public.remover_operador_loja(p_empresa,v_email);
    when 'terminal' then perform public.configurar_terminal_pdv(p_empresa,(p_dados->>'id')::uuid,p_dados->>'nome',v_email);
    when 'nome_pdv' then perform public.configurar_nome_pdv(p_empresa,p_dados->>'nome');
    else raise sqlstate '22023' using message='Operação da equipe inválida';
  end case;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.painel_equipe(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.painel_equipe(uuid,text,jsonb) to authenticated;

commit;
