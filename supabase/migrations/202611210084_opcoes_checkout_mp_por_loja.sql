begin;

create function painel_privado.habilitar_provedor_credenciado_mp()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.estado='ativa' then
    insert into public.provedores_pagamento(empresa_id,provedor,ambiente,pix_habilitado,credito_habilitado)
      values(new.empresa_id,new.provedor,new.ambiente,true,new.chave_publica is not null)
      on conflict(empresa_id,provedor,ambiente) do nothing;
  end if;
  return new;
end;
$$;
create trigger habilitar_provedor_credenciado_mp after insert or update of estado on painel_privado.credenciais_mp
for each row execute function painel_privado.habilitar_provedor_credenciado_mp();
revoke all on function painel_privado.habilitar_provedor_credenciado_mp() from public,anon,authenticated,service_role;

create function public.opcoes_mp_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('pix',p.pix_habilitado,'credito',p.credito_habilitado and c.chave_publica is not null,
    'chave_publica',case when p.credito_habilitado then c.chave_publica end)
  from public.empresas e join painel_privado.credenciais_mp c on c.empresa_id=e.id and c.estado='ativa'
  join public.provedores_pagamento p on p.empresa_id=c.empresa_id and p.ambiente=c.ambiente and p.provedor=c.provedor
  where e.cardapio_slug=p_slug and c.ambiente=case when p_slug='loja-teste' then 'sandbox' else 'producao' end
  and (select efetivo from painel_privado.situacao_empresa(e.id)) not in ('bloqueada_parcial','bloqueada_total');
$$;
revoke all on function public.opcoes_mp_cardapio(text) from public,anon,authenticated,service_role;
grant execute on function public.opcoes_mp_cardapio(text) to anon,authenticated;

commit;
