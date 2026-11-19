begin;

create or replace function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', e.nome, 'cor', e.cardapio_cor, 'fundo', e.cardapio_fundo,
    'logo', e.cardapio_logo, 'agradecimento', e.cardapio_agradecimento,
    'mapa_centro', case when e.mapa_centro_latitude is not null and e.mapa_centro_longitude is not null
      then jsonb_build_object('latitude', e.mapa_centro_latitude, 'longitude', e.mapa_centro_longitude)
      else null end,
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'preco_centavos',p.preco_centavos,
        'categoria',p.categoria,'descricao',p.descricao,'composicao',p.composicao,
        'foto',md5(p.foto_cardapio),'queridinho',p.queridinho) order by p.nome)
      from public.produtos p where p.empresa_id=e.id and p.ativo and p.visivel_cardapio
    ), '[]'::jsonb))
  from public.empresas e where e.cardapio_slug=p_slug;
$$;

commit;
