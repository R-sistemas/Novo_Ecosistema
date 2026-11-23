begin;

create function painel_privado.central_listar_licencas(p_busca text, p_pagina integer, p_limite integer, p_atencao boolean, p_situacao text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_busca text := lower(btrim(coalesce(p_busca,'')));
  resultado jsonb;
begin
  perform painel_privado.central_autor('central.empresas.ler');
  if p_situacao is not null and p_situacao not in ('em_dia','em_debito','bloqueada','sem_licenca','sem_plano') or length(v_busca)>120 or p_pagina is null or p_pagina not between 1 and 100000
    or p_limite is null or p_limite not between 1 and 100 then
    raise exception using errcode='22023',message='Consulta inválida';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.nome,r.id),'[]'::jsonb) into resultado
  from (
    select e.id,e.nome,e.cardapio_slug,coalesce(l.estado,'sem_classificacao') estado,
      l.plano,l.preco_centavos,l.vencimento,coalesce(l.pagamento,'pendente') pagamento,
      st.dias_em_atraso,coalesce(l.revisao,0) revisao,st.automatico situacao_automatica,
      st.efetivo situacao,coalesce(s.modo,'automatico') modo_suspensao,coalesce(s.revisao,0) revisao_suspensao
    from public.empresas e
    left join painel_privado.central_licencas l on l.empresa_id=e.id
    left join painel_privado.central_suspensoes s on s.empresa_id=e.id
    cross join lateral painel_privado.situacao_licenca(l.vencimento,l.pagamento,
      (statement_timestamp() at time zone 'America/Sao_Paulo')::date,s.modo) st
    where (v_busca='' or strpos(lower(e.nome),v_busca)>0 or strpos(lower(e.cardapio_slug),v_busca)>0)
      and (not p_atencao or st.efetivo<>'em_dia' or st.automatico<>'em_dia')
      and case p_situacao
        when 'em_dia' then st.efetivo = 'em_dia'
        when 'em_debito' then st.efetivo = 'em_debito'
        when 'bloqueada' then st.efetivo in ('bloqueada_parcial','bloqueada_total')
        when 'sem_licenca' then l.empresa_id is null
        when 'sem_plano' then l.empresa_id is not null and l.plano is null
        else true
      end
    order by e.nome,e.id offset ((p_pagina-1)*p_limite) limit (p_limite+1)
  ) r;
  return jsonb_build_object('empresas',case when jsonb_array_length(resultado)>p_limite
    then resultado-p_limite else resultado end,'tem_proxima',jsonb_array_length(resultado)>p_limite);
end;
$$;

create or replace function public.central_empresas(p_busca text,p_pagina integer,p_limite integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select painel_privado.central_listar_licencas(p_busca,p_pagina,p_limite,false,null);
$$;
create or replace function public.central_empresas_atencao(p_busca text,p_pagina integer,p_limite integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select painel_privado.central_listar_licencas(p_busca,p_pagina,p_limite,true,null);
$$;

drop function painel_privado.central_listar_licencas(text,integer,integer,boolean);

create function public.central_empresas_filtradas(p_busca text,p_pagina integer,p_limite integer,p_situacao text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select painel_privado.central_listar_licencas(p_busca,p_pagina,p_limite,false,p_situacao);
$$;

revoke all on function painel_privado.central_listar_licencas(text,integer,integer,boolean,text),
  public.central_empresas_filtradas(text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.central_empresas_filtradas(text,integer,integer,text) to authenticated;

commit;
