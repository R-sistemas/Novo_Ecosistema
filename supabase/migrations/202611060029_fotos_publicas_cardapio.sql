begin;

create function public.foto_publica_cardapio(p_produto uuid,p_versao text)
returns text language sql stable security definer set search_path = '' as $$
  select p.foto_cardapio from public.produtos p join public.empresas e on e.id=p.empresa_id
    where p.id=p_produto and p.ativo and e.cardapio_slug is not null and md5(p.foto_cardapio)=p_versao;
$$;
revoke execute on function public.foto_publica_cardapio(uuid,text) from public,anon,authenticated;
grant execute on function public.foto_publica_cardapio(uuid,text) to service_role;
create or replace function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', e.nome, 'cor', e.cardapio_cor, 'fundo', e.cardapio_fundo,
    'logo',e.cardapio_logo,'agradecimento',e.cardapio_agradecimento,'produtos',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'preco_centavos',p.preco_centavos,
      'categoria',p.categoria,'descricao',p.descricao,'composicao',p.composicao,
      'foto',md5(p.foto_cardapio),'queridinho',p.queridinho) order by p.nome)
    from public.produtos p where p.empresa_id=e.id and p.ativo
  ),'[]'::jsonb))
  from public.empresas e where e.cardapio_slug=p_slug;
$$;

commit;
