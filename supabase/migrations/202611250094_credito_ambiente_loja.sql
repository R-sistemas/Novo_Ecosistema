begin;

create or replace function public.opcoes_mp_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('pix',p.pix_habilitado,'credito',p.credito_habilitado and c.chave_publica is not null,
    'ambiente',c.ambiente,'chave_publica',case when p.credito_habilitado then c.chave_publica end)
  from public.empresas e join painel_privado.credenciais_mp c on c.empresa_id=e.id and c.estado='ativa'
  join public.provedores_pagamento p on p.empresa_id=c.empresa_id and p.ambiente=c.ambiente and p.provedor=c.provedor
  where e.cardapio_slug=p_slug and c.ambiente=case when e.sandbox_checkout then 'sandbox' else 'producao' end
  and (select efetivo from painel_privado.situacao_empresa(e.id)) not in ('bloqueada_parcial','bloqueada_total');
$$;

create function public.servico_mp_reserva_credito(
  p_slug text,p_id uuid,p_cliente text,p_mesa uuid,p_itens jsonb,p_ambiente text,p_chave_publica text,
  p_endereco jsonb default null,p_frete bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_empresa uuid;
  v_opcoes jsonb;
  v_reserva jsonb;
  v_recebedor text;
begin
  select id into v_empresa from public.empresas where cardapio_slug=p_slug for update;
  if v_empresa is not null then
    perform painel_privado.exigir_operacao_licenciada(v_empresa,true);
  end if;
  v_opcoes := public.opcoes_mp_cardapio(p_slug);
  if v_empresa is null or p_chave_publica is null or v_opcoes->>'credito' is distinct from 'true'
    or v_opcoes->>'ambiente' is distinct from p_ambiente
    or v_opcoes->>'chave_publica' is distinct from p_chave_publica then
    raise exception using errcode='PT409',message='Configuração de cartão desatualizada';
  end if;

  select recebedor into v_recebedor from painel_privado.credenciais_mp
    where empresa_id=v_empresa and ambiente=p_ambiente and estado='ativa';

  v_reserva := public.servico_mp_reserva_pedido(
    p_slug,p_id,p_cliente,p_mesa,p_itens,'credito',p_ambiente,p_endereco,p_frete,false
  );
  if coalesce((v_reserva->>'bloqueada')::boolean,false) then return v_reserva; end if;
  -- Na retomada, o envelope atual só é utilizado para o mesmo recebedor.
  if v_reserva->>'recebedor' is distinct from v_recebedor
    or v_reserva->>'empresa' is distinct from v_empresa::text
    or v_reserva->>'ambiente' is distinct from p_ambiente then
    raise exception using errcode='PT409',message='Configuração de cartão desatualizada';
  end if;
  return v_reserva;
end;
$$;

revoke all on function public.servico_mp_reserva_credito(text,uuid,text,uuid,jsonb,text,text,jsonb,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.servico_mp_reserva_credito(text,uuid,text,uuid,jsonb,text,text,jsonb,bigint)
  to service_role;

commit;
