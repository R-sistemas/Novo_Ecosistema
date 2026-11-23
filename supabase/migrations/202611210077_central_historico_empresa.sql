begin;

create index central_auditoria_empresa_historico
  on painel_privado.auditoria (entidade_id, ocorrido_em desc, id desc)
  where escopo = 'plataforma' and entidade = 'empresa';

create function public.central_historico_empresa(p_empresa uuid, p_pagina integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_eventos jsonb;
begin
  perform painel_privado.central_autor('central.empresas.ler');
  if p_empresa is null or p_pagina is null or p_pagina not between 1 and 100000 then
    raise exception using errcode = '22023', message = 'Consulta inválida';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then
    raise exception using errcode = 'P0002', message = 'Empresa inexistente';
  end if;
  select coalesce(jsonb_agg(to_jsonb(evento) order by ocorrido_em desc,id desc), '[]'::jsonb)
    into v_eventos
  from (
    select id, ocorrido_em, acao, motivo, antes, depois
    from painel_privado.auditoria
    where escopo = 'plataforma' and entidade = 'empresa' and entidade_id = p_empresa::text
      and acao in ('central.editar_licenca','central.registrar_pagamento',
        'central.alterar_suspensao','central.criar_empresa','central.vincular_gestor')
    order by ocorrido_em desc,id desc offset ((p_pagina - 1) * 20) limit 21
  ) evento;
  return jsonb_build_object('eventos', case when jsonb_array_length(v_eventos) > 20
    then v_eventos - 20 else v_eventos end, 'tem_proxima', jsonb_array_length(v_eventos) > 20);
end;
$$;

revoke all on function public.central_historico_empresa(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.central_historico_empresa(uuid,integer) to authenticated;

commit;
