begin;

-- O lock da empresa preserva campos omitidos sob edição concorrente.
-- Apenas este gateway privilegiado pode atualizar o centro do mapa.
create function public.painel_preferencias(p_empresa uuid,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  atual public.empresas;
  alvo public.empresas;
  mapa boolean;
  campos constant text[] := array['cardapio_cor','cardapio_fundo','cardapio_logo','cardapio_agradecimento',
    'mapa_centro_latitude','mapa_centro_longitude','pagamento_na_entrega'];
begin
  if p_empresa is null then raise insufficient_privilege; end if;
  perform public.painel_contexto_sessao(p_empresa);
  if p_dados is not null then
    if jsonb_typeof(p_dados) is distinct from 'object' or p_dados - campos <> '{}'::jsonb
      or exists(select 1 from jsonb_each(p_dados) j where
         case when j.key in ('mapa_centro_latitude','mapa_centro_longitude') then jsonb_typeof(j.value) not in ('null','number')
              when j.key='pagamento_na_entrega' then jsonb_typeof(j.value)<>'boolean'
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
    if atual.pagamento_na_entrega is distinct from alvo.pagamento_na_entrega then
      perform public.configurar_pagamento_na_entrega(p_empresa,alvo.pagamento_na_entrega);
    end if;
  end if;

  select e.* into atual from public.empresas e where e.id=p_empresa;
  return jsonb_build_object(
    'nome',atual.nome,'slug',atual.cardapio_slug,'cardapio_cor',atual.cardapio_cor,'cardapio_fundo',atual.cardapio_fundo,
    'cardapio_logo',atual.cardapio_logo,'cardapio_agradecimento',atual.cardapio_agradecimento,
    'mapa_centro_latitude',atual.mapa_centro_latitude,'mapa_centro_longitude',atual.mapa_centro_longitude,
    'pagamento_na_entrega',atual.pagamento_na_entrega,
    'metodos',case when atual.cardapio_slug is not null then public.metodos_checkout_publico(atual.cardapio_slug) end
  );
end;
$$;

revoke all on function public.painel_preferencias(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.painel_preferencias(uuid,jsonb) to authenticated;

commit;
