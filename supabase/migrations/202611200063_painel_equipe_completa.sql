begin;

alter table public.equipe_kds add column contato_cliente boolean not null default false;

create function public.configurar_contato_cliente_kds(p_empresa uuid,p_email text,p_permitir boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.eh_gestor_kds(p_empresa) then raise insufficient_privilege; end if;
  if p_permitir is null then raise sqlstate '22023' using message='Permissão inválida.'; end if;
  update public.equipe_kds k set contato_cliente=p_permitir from auth.users u
    where k.empresa_id=p_empresa and k.usuario_id=u.id and lower(u.email)=lower(btrim(p_email));
  if not found then raise insufficient_privilege; end if;
end;
$$;
revoke all on function public.configurar_contato_cliente_kds(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.configurar_contato_cliente_kds(uuid,text,boolean) to authenticated;

create or replace function painel_privado.snapshot_equipe(p_tabela text, p_linha jsonb)
returns jsonb language sql stable set search_path = ''
as $$
  select case when p_linha is not null then jsonb_strip_nulls(jsonb_build_object(
    'empresa_id', coalesce(p_linha->'empresa_id', p_linha->'id'),
    'usuario_id', coalesce(p_linha->'usuario_id', p_linha->'operador_id'),
    'email', (select u.email from auth.users u
      where u.id=(coalesce(p_linha->>'usuario_id',p_linha->>'operador_id'))::uuid),
    'papel', p_linha->'papel', 'edita_comanda', p_linha->'edita_comanda',
    'nome', case when p_tabela='terminais_pdv' then p_linha->'nome' end,
    'nome_pdv', p_linha->'nome_pdv', 'contato_cliente', p_linha->'contato_cliente'
  )) end;
$$;

create or replace function public.painel_equipe(p_empresa uuid,p_acao text,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_resultado jsonb;
  v_email text := lower(btrim(p_dados->>'email'));
begin
  if p_empresa is null then raise insufficient_privilege; end if;
  perform public.painel_contexto_sessao(p_empresa);
  if p_acao='listar' then
    select jsonb_build_object(
      'operadores',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('contato_cliente',coalesce((
        select k.contato_cliente from public.equipe_kds k join auth.users u on u.id=k.usuario_id
        where k.empresa_id=p_empresa and lower(u.email)=lower(o.email)
      ),false)) order by o.email)
        from public.listar_operadores_gestor(p_empresa) o),'[]'::jsonb),
      'terminais',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('ultimo_uso',(
        select max(c.aberto_em) from public.caixas c where c.empresa_id=p_empresa and c.terminal_id=t.id
      )) order by t.nome,t.id) from public.listar_terminais_gestor(p_empresa) t),'[]'::jsonb),
      'nome_pdv',(select e.nome_pdv from public.empresas e where e.id=p_empresa)
    ) into v_resultado;
    return v_resultado;
  end if;
  if p_acao in ('remover','terminal','edicao_comanda','contato_cliente') and not exists(
    select 1 from public.listar_operadores_gestor(p_empresa) o where lower(o.email)=v_email and case p_acao
      when 'terminal' then o.vendas when 'remover' then true else o.cozinha end
  ) then raise insufficient_privilege; end if;
  if p_acao in ('edicao_comanda','contato_cliente')
    and jsonb_typeof(p_dados->'permitir') is distinct from 'boolean' then
    raise sqlstate '22023' using message='Permissão inválida.';
  end if;
  case p_acao
    when 'remover' then perform public.remover_operador_loja(p_empresa,v_email);
    when 'terminal' then perform public.configurar_terminal_pdv(p_empresa,(p_dados->>'id')::uuid,p_dados->>'nome',v_email);
    when 'edicao_comanda' then perform public.configurar_edicao_kds(p_empresa,v_email,(p_dados->>'permitir')::boolean);
    when 'contato_cliente' then perform public.configurar_contato_cliente_kds(p_empresa,v_email,(p_dados->>'permitir')::boolean);
    when 'nome_pdv' then perform public.configurar_nome_pdv(p_empresa,p_dados->>'nome');
    else raise sqlstate '22023' using message='Operação da equipe inválida';
  end case;
  return jsonb_build_object('ok',true);
end;
$$;

commit;
