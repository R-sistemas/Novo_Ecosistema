begin;

alter table public.empresas
  add column oferece_entrega boolean not null default false,
  add column sandbox_checkout boolean not null default false;


create or replace function painel_privado.auditar_preferencias_loja()
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
      'mapa_centro_latitude','mapa_centro_longitude','pagamento_na_entrega','oferece_entrega')
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
drop trigger auditar_preferencias_loja on public.empresas;
create trigger auditar_preferencias_loja after update on public.empresas
  for each row when (
    (old.cardapio_cor,old.cardapio_fundo,old.cardapio_logo,old.cardapio_agradecimento,
      old.mapa_centro_latitude,old.mapa_centro_longitude,old.pagamento_na_entrega,old.oferece_entrega)
    is distinct from
    (new.cardapio_cor,new.cardapio_fundo,new.cardapio_logo,new.cardapio_agradecimento,
      new.mapa_centro_latitude,new.mapa_centro_longitude,new.pagamento_na_entrega,new.oferece_entrega)
  ) execute function painel_privado.auditar_preferencias_loja();





-- O lock da empresa preserva campos omitidos sob edição concorrente.
-- Apenas este gateway privilegiado pode atualizar o centro do mapa.
create or replace function public.painel_preferencias(p_empresa uuid,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  atual public.empresas;
  alvo public.empresas;
  mapa boolean;
  campos constant text[] := array['cardapio_cor','cardapio_fundo','cardapio_logo','cardapio_agradecimento',
    'mapa_centro_latitude','mapa_centro_longitude','pagamento_na_entrega','oferece_entrega'];
begin
  if p_empresa is null then raise insufficient_privilege; end if;
  perform public.painel_contexto_sessao(p_empresa);
  if p_dados is not null then
    if jsonb_typeof(p_dados) is distinct from 'object' or p_dados - campos <> '{}'::jsonb
      or exists(select 1 from jsonb_each(p_dados) j where
         case when j.key in ('mapa_centro_latitude','mapa_centro_longitude') then jsonb_typeof(j.value) not in ('null','number')
              when j.key in ('pagamento_na_entrega','oferece_entrega') then jsonb_typeof(j.value)<>'boolean'
              when j.key in ('cardapio_logo','cardapio_agradecimento') then jsonb_typeof(j.value) not in ('null','string')
              else jsonb_typeof(j.value)<>'string' end) then
      raise sqlstate '22023' using message='Preferências inválidas';
    end if;
    -- Mantém o vínculo válido até o fim da transação, inclusive no caminho do mapa.
    perform 1 from public.membros
      where empresa_id=p_empresa and usuario_id=auth.uid() and papel='gestor' for share;
    if not found then raise insufficient_privilege; end if;
    select e.* into atual from public.empresas e where e.id=p_empresa for update;
    alvo := jsonb_populate_record(atual,p_dados);
    mapa := p_dados ?| array['mapa_centro_latitude','mapa_centro_longitude'];
    if mapa and (
      not (p_dados ?& array['mapa_centro_latitude','mapa_centro_longitude'])
      or (alvo.mapa_centro_latitude is null) <> (alvo.mapa_centro_longitude is null)
      or (p_dados->>'mapa_centro_latitude')::numeric not between -90 and 90
      or (p_dados->>'mapa_centro_longitude')::numeric not between -180 and 180
    ) then raise sqlstate '22023' using message='Centro do mapa inválido'; end if;

    if (atual.cardapio_cor,atual.cardapio_fundo,atual.cardapio_logo,atual.cardapio_agradecimento)
      is distinct from (alvo.cardapio_cor,alvo.cardapio_fundo,alvo.cardapio_logo,alvo.cardapio_agradecimento) then
      perform public.configurar_aparencia_cardapio(p_empresa,alvo.cardapio_cor,alvo.cardapio_fundo,
        alvo.cardapio_logo,alvo.cardapio_agradecimento);
    end if;
    if mapa and (atual.mapa_centro_latitude,atual.mapa_centro_longitude)
      is distinct from (alvo.mapa_centro_latitude,alvo.mapa_centro_longitude) then
      update public.empresas set mapa_centro_latitude=alvo.mapa_centro_latitude,
        mapa_centro_longitude=alvo.mapa_centro_longitude where id=p_empresa;
    end if;
    if atual.oferece_entrega is distinct from alvo.oferece_entrega then
      update public.empresas set oferece_entrega=alvo.oferece_entrega where id=p_empresa;
    end if;
    if atual.pagamento_na_entrega is distinct from alvo.pagamento_na_entrega then
      perform public.configurar_pagamento_na_entrega(p_empresa,alvo.pagamento_na_entrega);
    end if;
  end if;

  select e.* into atual from public.empresas e where e.id=p_empresa;
  return jsonb_build_object(
    'nome',atual.nome,'slug',atual.cardapio_slug,'cardapio_cor',atual.cardapio_cor,'cardapio_fundo',atual.cardapio_fundo,
    'cardapio_logo',atual.cardapio_logo,'cardapio_agradecimento',atual.cardapio_agradecimento,
    'mapa_centro_latitude',atual.mapa_centro_latitude,'mapa_centro_longitude',atual.mapa_centro_longitude,
    'pagamento_na_entrega',atual.pagamento_na_entrega,'oferece_entrega',atual.oferece_entrega,
    'metodos',case when atual.cardapio_slug is not null then public.metodos_checkout_publico(atual.cardapio_slug) end
  );
end;
$$;

revoke all on function public.painel_preferencias(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.painel_preferencias(uuid,jsonb) to authenticated;



create or replace function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('oferece_entrega',e.oferece_entrega,'sandbox_checkout',e.sandbox_checkout,
    'mp_legado',exists(select 1 from painel_privado.mp_legado_empresa m where m.empresa_id=e.id and m.ambiente='producao'),
    'nome', e.nome, 'cor', e.cardapio_cor, 'fundo', e.cardapio_fundo,
    'logo', e.cardapio_logo, 'agradecimento', e.cardapio_agradecimento,
    'mapa_centro', case when e.mapa_centro_latitude is not null and e.mapa_centro_longitude is not null
      then jsonb_build_object('latitude', e.mapa_centro_latitude, 'longitude', e.mapa_centro_longitude)
      else null end,
    'fechado', st.efetivo in ('bloqueada_parcial','bloqueada_total'),
    'produtos', case when st.efetivo in ('bloqueada_parcial','bloqueada_total') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'preco_centavos',p.preco_centavos,
        'categoria',p.categoria,'descricao',p.descricao,'composicao',p.composicao,
        'foto',md5(p.foto_cardapio),'queridinho',p.queridinho) order by p.nome)
      from public.produtos p where p.empresa_id=e.id and p.ativo and p.visivel_cardapio
    ), '[]'::jsonb) end)
  from public.empresas e cross join lateral painel_privado.situacao_empresa(e.id) st where e.cardapio_slug=p_slug;
$$;
-- Transição explícita da loja com entrega já em operação.
update public.empresas set oferece_entrega=true where cardapio_slug='quiosque-dorafa';

update public.empresas set sandbox_checkout=true where cardapio_slug='loja-teste';

commit;