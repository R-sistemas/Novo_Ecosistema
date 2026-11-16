begin;

-- O checkout com frete soma a taxa ao total após reservar o pedido.
grant update (total_centavos) on public.pedidos_online to service_role;

-- As quatro rotas já usam bloqueios consultivos de transação. O FOR UPDATE
-- adicional exige UPDATE em entregas_pedido, embora nenhuma delas altere a
-- entrega nesse ponto. Removê-lo preserva a serialização sem ampliar acesso.
do $$
declare
  v_func regprocedure;
  v_original text;
  v_nova text;
begin
  foreach v_func in array array[
    'public.reservar_pix_entrega_frete_quiosque(uuid,text,jsonb,jsonb,bigint)'::regprocedure,
    'public.reservar_pix_entrega_frete_teste(uuid,text,jsonb,jsonb,bigint)'::regprocedure,
    'public.enviar_pedido_pagamento_na_entrega_com_frete(text,uuid,text,jsonb,jsonb,bigint)'::regprocedure,
    'public.reservar_credito_entrega_frete_quiosque(uuid,text,jsonb,jsonb,bigint)'::regprocedure
  ] loop
    v_original := pg_get_functiondef(v_func);
    v_nova := regexp_replace(v_original, 'for[[:space:]]+update', '', 'gi');
    if v_nova <> v_original then
      execute v_nova;
    end if;
  end loop;
end;
$$;

commit;
notify pgrst, 'reload schema';
