begin;

create table painel_privado.central_pagamentos_licenca (
  empresa_id uuid not null references public.empresas(id),
  vencimento date not null,
  data_pagamento date not null,
  valor_centavos integer not null check (valor_centavos > 0),
  requisicao_id uuid not null unique,
  primary key (empresa_id, vencimento)
);
alter table painel_privado.central_pagamentos_licenca enable row level security;
revoke all on painel_privado.central_pagamentos_licenca from public, anon, authenticated, service_role;

create function painel_privado.central_validar_dia_vencimento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.vencimento is not distinct from old.vencimento then
    return new;
  end if;
  if extract(day from new.vencimento) <> 5 then
    raise exception using errcode = '22023', message = 'O vencimento deve cair no dia 5';
  end if;
  return new;
end;
$$;
revoke all on function painel_privado.central_validar_dia_vencimento()
  from public, anon, authenticated, service_role;

create trigger central_validar_dia_vencimento
after insert or update of vencimento on painel_privado.central_licencas
for each row execute function painel_privado.central_validar_dia_vencimento();

create function public.central_registrar_pagamento(
  p_empresa uuid, p_revisao integer, p_vencimento date,
  p_data_pagamento date, p_valor_centavos integer, p_requisicao uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := painel_privado.central_autor('central.empresas.gerir');
  v_licenca painel_privado.central_licencas;
  v_evento painel_privado.auditoria;
  v_fato jsonb;
  v_resultado jsonb;
begin
  if p_empresa is null or p_requisicao is null or p_revisao is null
    or p_revisao not between 1 and 2147483646
    or p_vencimento is null or p_vencimento not between date '1900-01-01' and date '9999-11-30'
    or p_data_pagamento is null or p_data_pagamento not between date '1900-01-01'
      and (pg_catalog.now() at time zone 'America/Sao_Paulo')::date
    or p_valor_centavos is null or p_valor_centavos <= 0 then
    raise exception using errcode = '22023', message = 'Pagamento inválido';
  end if;
  perform 1 from public.empresas where id = p_empresa for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Empresa inexistente';
  end if;

  v_fato := jsonb_build_object('vencimento_quitado', p_vencimento,
    'data_pagamento', p_data_pagamento, 'valor_centavos', p_valor_centavos);
  select * into v_evento from painel_privado.auditoria
    where escopo = 'plataforma' and acao = 'central.registrar_pagamento' and requisicao_id = p_requisicao;
  if found then
    if v_evento.autor_id = v_autor and v_evento.entidade_id = p_empresa::text
      and v_evento.antes->>'revisao' = p_revisao::text and v_evento.depois @> v_fato then
      return v_evento.depois;
    end if;
    raise exception using errcode = '23505', message = 'Requisição já utilizada';
  end if;

  select * into v_licenca from painel_privado.central_licencas where empresa_id = p_empresa;
  if not found or v_licenca.revisao <> p_revisao
    or v_licenca.vencimento is distinct from p_vencimento
    or v_licenca.pagamento <> 'pendente' then
    raise exception using errcode = '23505', message = 'Ciclo pendente atualizado em outra sessão';
  end if;
  insert into painel_privado.central_pagamentos_licenca
    values (p_empresa, p_vencimento, p_data_pagamento, p_valor_centavos, p_requisicao);
  update painel_privado.central_licencas
    set vencimento = (pg_catalog.date_trunc('month', p_vencimento::timestamp)
        + interval '1 month 4 days')::date,
      pagamento = 'pendente', revisao = p_revisao + 1
    where empresa_id = p_empresa
    returning to_jsonb(central_licencas) || v_fato into v_resultado;
  insert into painel_privado.auditoria
    (autor_id, escopo, empresa_id, acao, entidade, entidade_id, antes, depois, motivo, requisicao_id)
    values (v_autor, 'plataforma', null, 'central.registrar_pagamento', 'empresa', p_empresa::text,
      to_jsonb(v_licenca), v_resultado, 'Quitação de mensalidade', p_requisicao);
  return v_resultado;
end;
$$;

revoke all on function public.central_registrar_pagamento(uuid,integer,date,date,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.central_registrar_pagamento(uuid,integer,date,date,integer,uuid)
  to authenticated;

commit;
