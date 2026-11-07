begin;

alter table public.empresas add column cardapio_cor text not null default '#175d2d'
  check (cardapio_cor ~ '^#[0-9a-fA-F]{6}$'),
  add column cardapio_fundo text not null default '#f4f6f2'
  check (cardapio_fundo in ('#f4f6f2','#ffffff','#f1f3f5','#f8f4eb')),
  add column cardapio_logo text check (length(cardapio_logo) <= 44000 and cardapio_logo ~ '^data:image/webp;base64,[A-Za-z0-9+/]+=*$'),
  add column cardapio_agradecimento text check (length(cardapio_agradecimento) <= 82000 and cardapio_agradecimento ~ '^data:image/webp;base64,[A-Za-z0-9+/]+=*$');

alter table public.produtos add column categoria text check (length(categoria) <= 60),
  add column descricao text check (length(descricao) <= 500),
  add column composicao text check (length(composicao) <= 500),
  add column foto_cardapio text check (length(foto_cardapio) <= 82000 and foto_cardapio ~ '^data:image/webp;base64,[A-Za-z0-9+/]+=*$'),
  add column queridinho boolean not null default false;

create function public.configurar_aparencia_cardapio(p_empresa uuid,p_cor text,p_fundo text,p_logo text,p_agradecimento text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.empresas e set cardapio_cor=p_cor, cardapio_fundo=p_fundo,
    cardapio_logo=nullif(p_logo,''), cardapio_agradecimento=nullif(p_agradecimento,'')
    where e.id=p_empresa and exists (select 1 from public.membros m
      where m.empresa_id=e.id and m.usuario_id=auth.uid() and m.papel='gestor');
  if not found then raise exception 'Somente o gestor pode alterar a aparência.' using errcode='42501'; end if;
end;
$$;
revoke execute on function public.configurar_aparencia_cardapio(uuid,text,text,text,text) from public,anon;
grant execute on function public.configurar_aparencia_cardapio(uuid,text,text,text,text) to authenticated;

create or replace function public.ver_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nome', e.nome, 'cor', e.cardapio_cor, 'fundo', e.cardapio_fundo,
    'logo',e.cardapio_logo,'agradecimento',e.cardapio_agradecimento,'produtos',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'nome',p.nome,'preco_centavos',p.preco_centavos,
      'categoria',p.categoria,'descricao',p.descricao,'composicao',p.composicao,
      'foto',p.foto_cardapio,'queridinho',p.queridinho) order by p.nome)
    from public.produtos p where p.empresa_id=e.id and p.ativo
  ),'[]'::jsonb))
  from public.empresas e where e.cardapio_slug=p_slug;
$$;

commit;
