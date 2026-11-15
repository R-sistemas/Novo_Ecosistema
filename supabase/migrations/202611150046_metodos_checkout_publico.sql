begin;

create function public.metodos_checkout_publico(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pix', coalesce(bool_or(p.provedor = 'mercado_pago' and p.ambiente = 'producao' and p.pix_habilitado), false),
    'credito', coalesce(bool_or(p.provedor = 'mercado_pago' and p.ambiente = 'producao' and p.credito_habilitado), false),
    'debito', false
  )
  from public.empresas e
  left join public.provedores_pagamento p on p.empresa_id = e.id
  where e.cardapio_slug = p_slug;
$$;

revoke execute on function public.metodos_checkout_publico(text) from public;
grant execute on function public.metodos_checkout_publico(text) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
