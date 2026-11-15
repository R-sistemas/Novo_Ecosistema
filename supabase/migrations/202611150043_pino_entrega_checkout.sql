begin;

create or replace function public.normalizar_endereco_entrega(p_endereco jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_endereco jsonb;
  v_latitude numeric;
  v_longitude numeric;
  v_mapa text;
begin
  if jsonb_typeof(p_endereco) is distinct from 'object' then
    raise exception 'Informe a localização da entrega.';
  end if;
  if p_endereco ? 'latitude' or p_endereco ? 'longitude' or p_endereco ? 'maps_url' then
    if jsonb_typeof(p_endereco->'latitude') <> 'number'
       or jsonb_typeof(p_endereco->'longitude') <> 'number' then
      raise exception 'Confirme o pino da entrega.';
    end if;
    v_latitude := round((p_endereco->>'latitude')::numeric, 6);
    v_longitude := round((p_endereco->>'longitude')::numeric, 6);
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception 'Coordenadas da entrega inválidas.';
    end if;
    v_mapa := 'https://www.google.com/maps?q=' || to_char(v_latitude, 'FM999990.000000') || ',' || to_char(v_longitude, 'FM999990.000000');
    if p_endereco->>'maps_url' is distinct from v_mapa then
      raise exception 'Link do pino divergente.';
    end if;
  end if;
  v_endereco := jsonb_strip_nulls(jsonb_build_object(
    'maps_url', v_mapa,
    'latitude', v_latitude,
    'longitude', v_longitude,
    'logradouro', nullif(btrim(p_endereco->>'logradouro'), ''),
    'numero', nullif(btrim(p_endereco->>'numero'), ''),
    'bairro', nullif(btrim(p_endereco->>'bairro'), ''),
    'cidade', nullif(btrim(p_endereco->>'cidade'), ''),
    'complemento', nullif(btrim(p_endereco->>'complemento'), ''),
    'telefone', nullif(btrim(p_endereco->>'telefone'), ''),
    'metodo_pagamento', nullif(btrim(p_endereco->>'metodo_pagamento'), ''),
    'troco_para_centavos', p_endereco->'troco_para_centavos'
  ));
  if (v_mapa is null and not (v_endereco ?& array['logradouro','numero','bairro','cidade']))
     or length(v_endereco->>'logradouro') > 150
     or length(v_endereco->>'numero') > 20
     or length(v_endereco->>'bairro') > 100
     or length(v_endereco->>'cidade') > 100
     or length(v_endereco->>'complemento') > 150
     or (v_endereco ? 'telefone' and (v_endereco->>'telefone') !~ '^\d{10,11}$')
     or (v_endereco ? 'metodo_pagamento' and v_endereco->>'metodo_pagamento' not in ('pix','credito','dinheiro','maquininha'))
     or (v_endereco ? 'troco_para_centavos' and
       (jsonb_typeof(v_endereco->'troco_para_centavos') <> 'number' or (v_endereco->>'troco_para_centavos')::numeric < 0)) then
    raise exception 'Confira os dados da entrega.';
  end if;
  return v_endereco;
end;
$$;

revoke execute on function public.normalizar_endereco_entrega(jsonb) from public, anon, authenticated;
grant execute on function public.normalizar_endereco_entrega(jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
