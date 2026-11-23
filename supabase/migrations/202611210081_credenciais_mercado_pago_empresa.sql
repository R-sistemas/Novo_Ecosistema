begin;

create table painel_privado.credenciais_mp (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  provedor text not null default 'mercado_pago' check (provedor = 'mercado_pago'),
  ambiente text not null check (ambiente in ('producao','sandbox')),
  recebedor text not null check (recebedor ~ '^[0-9]{1,32}$'),
  envelope text not null check (length(envelope) between 40 and 6000),
  chave_publica text check (length(chave_publica) between 1 and 240),
  estado text not null check (estado in ('ativa','pendente','historica','revogada')),
  revisao integer not null check (revisao > 0),
  unique (empresa_id,ambiente,revisao)
);
create unique index credenciais_mp_ativa on painel_privado.credenciais_mp (empresa_id,ambiente) where estado='ativa';
create unique index credenciais_mp_pendente on painel_privado.credenciais_mp (empresa_id,ambiente) where estado='pendente';
alter table painel_privado.credenciais_mp enable row level security;
revoke all on painel_privado.credenciais_mp from public,anon,authenticated,service_role;

create function painel_privado.mp_status(p_empresa uuid,p_ambiente text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('configurado',coalesce(bool_or(estado='ativa'),false),
    'revisao',coalesce(max(revisao),0),
    'pendente',max(id::text) filter (where estado='pendente'),
    'integracao',max(id::text) filter (where estado='ativa'),
    'recebedor_pendente',max(recebedor) filter (where estado='pendente'))
  from painel_privado.credenciais_mp where empresa_id=p_empresa and ambiente=p_ambiente;
$$;

create function public.loja_status_credencial_mp(p_empresa uuid,p_ambiente text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid() and papel='gestor') then
    raise exception using errcode='42501',message='Acesso negado';
  end if;
  return painel_privado.mp_status(p_empresa,p_ambiente) - 'pendente' - 'recebedor_pendente' - 'integracao' ||
    jsonb_build_object('troca_pendente',painel_privado.mp_status(p_empresa,p_ambiente)->>'pendente' is not null,
      'rota_webhook',coalesce(painel_privado.mp_status(p_empresa,p_ambiente)->>'pendente',
        painel_privado.mp_status(p_empresa,p_ambiente)->>'integracao'));
end;
$$;

create function public.central_status_credencial_mp(p_empresa uuid,p_ambiente text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform painel_privado.central_autor('central.empresas.ler');
  return painel_privado.mp_status(p_empresa,p_ambiente);
end;
$$;

create function public.servico_gravar_credencial_mp(
  p_empresa uuid,p_ambiente text,p_autor uuid,p_recebedor text,p_envelope text,
  p_chave_publica text,p_revisao integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_slug text;
  v_atual painel_privado.credenciais_mp;
  v_nova painel_privado.credenciais_mp;
  v_estado text;
begin
  select cardapio_slug into v_slug from public.empresas where id=p_empresa for update;
  if not found or not exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=p_autor and papel='gestor') then
    raise exception using errcode='42501',message='Acesso negado';
  end if;
  if p_revisao is distinct from (painel_privado.mp_status(p_empresa,p_ambiente)->>'revisao')::integer then
    raise exception using errcode='23505',message='Configuração desatualizada';
  end if;
  select * into v_atual from painel_privado.credenciais_mp
    where empresa_id=p_empresa and ambiente=p_ambiente and estado in ('ativa','revogada')
    order by (estado='ativa') desc,revisao desc limit 1;
  v_estado := case
    when v_atual.recebedor=p_recebedor then 'ativa'
    when p_revisao=0 and coalesce(v_slug,'') not in ('quiosque-dorafa','loja-teste') then 'ativa'
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

create function public.central_aprovar_recebedor_mp(
  p_empresa uuid,p_integracao uuid,p_revisao integer,p_canal text,p_motivo text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := painel_privado.central_autor('central.empresas.gerir');
  v_pendente painel_privado.credenciais_mp;
begin
  if p_canal is null or p_canal not in ('telefone','email','whatsapp')
    or btrim(p_motivo) is null or length(btrim(p_motivo)) not between 1 and 240 then
    raise exception using errcode='22023',message='Informe o canal e a confirmação';
  end if;
  perform 1 from public.empresas where id=p_empresa for update;
  select * into v_pendente from painel_privado.credenciais_mp
    where id=p_integracao and empresa_id=p_empresa and estado='pendente';
  if p_revisao is distinct from (painel_privado.mp_status(p_empresa,v_pendente.ambiente)->>'revisao')::integer then
    raise exception using errcode='23505',message='Solicitação desatualizada';
  end if;
  if not found then raise exception using errcode='23505',message='Solicitação desatualizada'; end if;
  update painel_privado.credenciais_mp set estado='historica'
    where empresa_id=p_empresa and ambiente=v_pendente.ambiente and estado='ativa';
  update painel_privado.credenciais_mp set estado='ativa',revisao=p_revisao+1 where id=v_pendente.id;
  insert into painel_privado.auditoria (autor_id,escopo,acao,entidade,entidade_id,depois,motivo,requisicao_id)
    values(v_autor,'plataforma','central.aprovar_recebedor_mp','empresa',p_empresa::text,
      jsonb_build_object('ambiente',v_pendente.ambiente,'revisao',v_pendente.revisao,'canal',p_canal),
      btrim(p_motivo),v_pendente.id);
  return jsonb_build_object('configurado',true);
end;
$$;

revoke all on function painel_privado.mp_status(uuid,text),
  public.loja_status_credencial_mp(uuid,text), public.central_status_credencial_mp(uuid,text),
  public.servico_gravar_credencial_mp(uuid,text,uuid,text,text,text,integer),
  public.central_aprovar_recebedor_mp(uuid,uuid,integer,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.loja_status_credencial_mp(uuid,text), public.central_status_credencial_mp(uuid,text),
  public.central_aprovar_recebedor_mp(uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.servico_gravar_credencial_mp(uuid,text,uuid,text,text,text,integer) to service_role;

create function public.loja_revogar_credencial_mp(p_empresa uuid,p_ambiente text,p_revisao integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := auth.uid();
  v_ativa painel_privado.credenciais_mp;
  v_requisicao uuid := gen_random_uuid();
begin
  perform 1 from public.empresas where id=p_empresa for update;
  if not exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=v_autor and papel='gestor') then
    raise exception using errcode='42501',message='Acesso negado';
  end if;
  if p_revisao is distinct from (painel_privado.mp_status(p_empresa,p_ambiente)->>'revisao')::integer then
    raise exception using errcode='23505',message='Configuração desatualizada';
  end if;
  select * into v_ativa from painel_privado.credenciais_mp
    where empresa_id=p_empresa and ambiente=p_ambiente and estado='ativa';
  if not found then return jsonb_build_object('configurado',false); end if;
  update painel_privado.credenciais_mp set estado='revogada',revisao=p_revisao+1
    where id=v_ativa.id;
  insert into painel_privado.auditoria (autor_id,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
    values(v_autor,'loja',p_empresa,'loja.revogar_credencial_mp','empresa',p_empresa::text,
      jsonb_build_object('ambiente',p_ambiente,'revisao',v_ativa.revisao,'estado','revogada'),v_requisicao);
  return jsonb_build_object('configurado',false);
end;
$$;
revoke all on function public.loja_revogar_credencial_mp(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.loja_revogar_credencial_mp(uuid,text,integer) to authenticated;

commit;
