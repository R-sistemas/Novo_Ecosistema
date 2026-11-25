begin;

create or replace function public.opcoes_mp_cardapio(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('pix',p.pix_habilitado,'credito',p.credito_habilitado and c.chave_publica is not null,
    'chave_publica',case when p.credito_habilitado then c.chave_publica end)
  from public.empresas e join painel_privado.credenciais_mp c on c.empresa_id=e.id and c.estado='ativa'
  join public.provedores_pagamento p on p.empresa_id=c.empresa_id and p.ambiente=c.ambiente and p.provedor=c.provedor
  where e.cardapio_slug=p_slug and c.ambiente=case when e.sandbox_checkout then 'sandbox' else 'producao' end
  and (select efetivo from painel_privado.situacao_empresa(e.id)) not in ('bloqueada_parcial','bloqueada_total');
$$;

create or replace function public.servico_gravar_credencial_mp(
  p_empresa uuid,p_ambiente text,p_autor uuid,p_recebedor text,p_envelope text,
  p_chave_publica text,p_revisao integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sandbox boolean;
  v_atual painel_privado.credenciais_mp;
  v_nova painel_privado.credenciais_mp;
  v_estado text;
begin
  select sandbox_checkout into v_sandbox from public.empresas where id=p_empresa for update;
  if not found or not exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=p_autor and papel='gestor') then
    raise exception using errcode='42501',message='Acesso negado';
  end if;
  if (p_ambiente='sandbox' and (v_sandbox is distinct from true or p_recebedor is distinct from '3095871690'))
    or (p_ambiente='producao' and p_recebedor='3095871690') then
    raise exception using errcode='22023',message='Recebedor incompatível com o ambiente';
  end if;
  if p_revisao is distinct from (painel_privado.mp_status(p_empresa,p_ambiente)->>'revisao')::integer then
    raise exception using errcode='23505',message='Configuração desatualizada';
  end if;
  select * into v_atual from painel_privado.credenciais_mp
    where empresa_id=p_empresa and ambiente=p_ambiente and estado in ('ativa','revogada')
    order by (estado='ativa') desc,revisao desc limit 1;
  v_estado := case
    when v_atual.recebedor=p_recebedor then 'ativa'
    else 'pendente' end;
  update painel_privado.credenciais_mp set estado='historica'
    where empresa_id=p_empresa and ambiente=p_ambiente
      and ((estado='ativa' and v_estado='ativa') or (estado='pendente' and v_estado='pendente'));
  insert into painel_privado.credenciais_mp (empresa_id,ambiente,recebedor,envelope,chave_publica,estado,revisao)
    values(p_empresa,p_ambiente,p_recebedor,p_envelope,p_chave_publica,v_estado,p_revisao+1) returning * into v_nova;
  insert into painel_privado.auditoria (autor_id,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
    values(p_autor,'loja',p_empresa,case when v_estado='ativa' then 'loja.configurar_conta_mp' else 'loja.solicitar_recebedor_mp' end,
      'empresa',p_empresa::text,jsonb_build_object('ambiente',p_ambiente,'revisao',v_nova.revisao,'estado',v_estado),v_nova.id);
  return jsonb_build_object('estado',v_estado,'revisao',v_nova.revisao);
end;
$$;

create or replace function public.central_status_credencial_mp(p_empresa uuid,p_ambiente text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform painel_privado.central_autor('central.empresas.ler');
  return painel_privado.mp_status(p_empresa,p_ambiente) || jsonb_build_object(
    'sandbox_disponivel', exists(select 1 from public.empresas where id=p_empresa and sandbox_checkout)
  );
end;
$$;

commit;