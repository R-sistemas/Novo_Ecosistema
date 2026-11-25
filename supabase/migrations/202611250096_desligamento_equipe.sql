begin;

alter table public.membros add column vinculo_id uuid not null default gen_random_uuid();

create table painel_privado.suspensoes_equipe (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  usuario_id uuid not null references auth.users(id),
  suspenso_por uuid not null references auth.users(id),
  suspenso_em timestamptz not null default now(),
  motivo text not null,
  vendas boolean not null,
  cozinha boolean not null,
  finalizado_por uuid references auth.users(id),
  finalizado_em timestamptz
);
create unique index suspensoes_equipe_vigentes on painel_privado.suspensoes_equipe(empresa_id,usuario_id)
  where finalizado_em is null;
alter table painel_privado.suspensoes_equipe enable row level security;
revoke all on painel_privado.suspensoes_equipe from public,anon,authenticated,service_role;

create function painel_privado.recusar_vinculo_suspenso()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.empresa_id::text||':'||new.usuario_id::text,97));
  if exists(select 1 from painel_privado.suspensoes_equipe s
    where s.empresa_id=new.empresa_id and s.usuario_id=new.usuario_id and s.finalizado_em is null)
    then raise insufficient_privilege; end if;
  return new;
end;
$$;
create trigger recusar_vinculo_suspenso before insert on public.membros
  for each row when (new.papel='operador') execute function painel_privado.recusar_vinculo_suspenso();
create trigger recusar_vinculo_suspenso before insert on public.equipe_kds
  for each row execute function painel_privado.recusar_vinculo_suspenso();

create or replace function public.caixa_do_operador(p_caixa uuid)
returns public.caixas language plpgsql security definer set search_path = '' as $$
declare v_caixa public.caixas;
begin
  select c.* into v_caixa from public.caixas c where c.id=p_caixa and c.operador_id=auth.uid();
  if not found then raise insufficient_privilege using message='Caixa indisponível.'; end if;
  perform 1 from public.membros m where m.empresa_id=v_caixa.empresa_id and m.usuario_id=auth.uid() for share;
  if not found then raise insufficient_privilege using message='Caixa indisponível.'; end if;
  select c.* into v_caixa from public.caixas c where c.id=p_caixa for update;
  return v_caixa;
end;
$$;

create function painel_privado.bloquear_acesso_cozinha(p_empresa uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock_shared(hashtextextended(p_empresa::text||':'||auth.uid()::text,97))
    where auth.uid() is not null and p_empresa is not null;
$$;

create or replace function public.pode_operar_cozinha(p_empresa uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform painel_privado.bloquear_acesso_cozinha(p_empresa);
  return exists(select 1 from public.membros where empresa_id=p_empresa and usuario_id=auth.uid())
    or exists(select 1 from public.equipe_kds where empresa_id=p_empresa and usuario_id=auth.uid());
end;
$$;

create or replace function public.pode_editar_comanda_kds(p_empresa uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform painel_privado.bloquear_acesso_cozinha(p_empresa);
  return public.eh_gestor_kds(p_empresa) or exists(
    select 1 from public.equipe_kds where empresa_id=p_empresa and usuario_id=auth.uid() and edita_comanda);
end;
$$;

create function painel_privado.invalidar_convites_desligamento(p_empresa uuid,p_usuario uuid,p_email text)
returns void language sql set search_path = '' as $$
  update painel_privado.convites_equipe c
    set estado=case when c.estado='pendente' then 'cancelado' else c.estado end,
      concluido_em=case when c.estado='pendente' then now() else c.concluido_em end,
      segredo=sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8'))
    where c.empresa_id=p_empresa and (c.destinatario=p_usuario or c.email=p_email)
      and c.estado in ('pendente','aceito');
$$;

create function painel_privado.auditar_desligamento(p_empresa uuid,p_id uuid,p_acao text,p_dados jsonb)
returns void language sql set search_path = '' as $$
  insert into painel_privado.auditoria
    (autor_id,origem_autor,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
  values (auth.uid(),'usuario','loja',p_empresa,'equipe.desligamento.'||p_acao,'suspensao_equipe',p_id::text,p_dados,p_id);
$$;

create function painel_privado.fechar_turno_equipe(p_caixa public.caixas,p_contado bigint)
returns bigint language plpgsql set search_path = '' as $$
begin
  if p_caixa.fechado_em is not null then raise exception 'Caixa fechado.'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Valor contado inválido.'; end if;
  update public.caixas set fechado_em=now(),contado_centavos=p_contado where id=p_caixa.id;
  return public.saldo_caixa(p_caixa.id,p_caixa.abertura_centavos);
end;
$$;

create or replace function public.fechar_caixa(p_caixa uuid,p_contado bigint)
returns bigint language sql security definer set search_path = '' as $$
  select painel_privado.fechar_turno_equipe(public.caixa_do_operador(p_caixa),p_contado);
$$;

create function public.operar_desligamento_equipe(p_empresa uuid,p_acao text,p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  alvo uuid;
  email_alvo text;
  motivo_alvo text := nullif(btrim(p_dados->>'motivo'),'');
  suspensao painel_privado.suspensoes_equipe;
  caixa public.caixas;
  havia_vendas boolean;
  havia_cozinha boolean;
  contado bigint;
  esperado bigint;
begin
  perform 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=auth.uid()
    and m.papel='gestor' for share;
  if not found then raise insufficient_privilege; end if;

  if p_acao='listar' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'email',u.email,'motivo',s.motivo,
      'aberto_em',c.aberto_em,'caixa',c.id,'terminal',t.nome)
      order by s.suspenso_em,s.id)
      from painel_privado.suspensoes_equipe s join auth.users u on u.id=s.usuario_id
      left join public.caixas c on c.empresa_id=s.empresa_id and c.operador_id=s.usuario_id and c.fechado_em is null
      left join public.terminais_pdv t on t.empresa_id=c.empresa_id and t.id=c.terminal_id
      where s.empresa_id=p_empresa and s.finalizado_em is null),'[]'::jsonb);
  end if;

  if p_acao in ('suspender','remover') then
    if p_acao='suspender' and (motivo_alvo is null or length(motivo_alvo)>240) then raise sqlstate '22023'; end if;
    email_alvo := lower(btrim(p_dados->>'email'));
    select u.id into alvo from auth.users u where lower(u.email)=email_alvo and (
      exists(select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=u.id and m.papel='operador')
        or exists(select 1 from public.equipe_kds k where k.empresa_id=p_empresa and k.usuario_id=u.id)
    );
    if not found or alvo=auth.uid() then raise insufficient_privilege; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_empresa::text||':'||email_alvo,96));
    perform pg_advisory_xact_lock(hashtextextended(p_empresa::text||':'||alvo::text,97));

    perform 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=alvo and m.papel='operador' for update;
    havia_vendas := found;
    perform 1 from public.equipe_kds k where k.empresa_id=p_empresa and k.usuario_id=alvo for update;
    havia_cozinha := found;
    if not (havia_vendas or havia_cozinha) or exists (
      select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=alvo and m.papel='gestor'
    ) then raise insufficient_privilege; end if;
    if p_acao='remover' and exists (
      select 1 from public.caixas c where c.empresa_id=p_empresa and c.operador_id=alvo and c.fechado_em is null
    ) then raise exception 'Feche o turno do operador ou suspenda o acesso.'; end if;

    insert into painel_privado.suspensoes_equipe
      (empresa_id,usuario_id,suspenso_por,motivo,vendas,cozinha,finalizado_por,finalizado_em)
    values (p_empresa,alvo,auth.uid(),coalesce(motivo_alvo,'Remoção pelo gestor'),havia_vendas,havia_cozinha,
      case when p_acao='remover' then auth.uid() end,case when p_acao='remover' then now() end)
    returning * into suspensao;
    delete from public.membros m where m.empresa_id=p_empresa and m.usuario_id=alvo and m.papel='operador';
    delete from public.equipe_kds k where k.empresa_id=p_empresa and k.usuario_id=alvo;
    perform painel_privado.invalidar_convites_desligamento(p_empresa,alvo,email_alvo);
    perform painel_privado.auditar_desligamento(p_empresa,suspensao.id,p_acao,
      jsonb_build_object('usuario_id',alvo,'motivo',suspensao.motivo));
    return jsonb_build_object('id',suspensao.id);
  end if;

  if p_acao is null or p_acao not in ('reconciliar','desvincular') then raise sqlstate '22023'; end if;
  select s.* into suspensao from painel_privado.suspensoes_equipe s
    where s.id=(p_dados->>'id')::uuid and s.empresa_id=p_empresa and s.finalizado_em is null for update;
  if not found then raise insufficient_privilege; end if;

  if p_acao='reconciliar' then
    select c.* into caixa from public.caixas c where c.id=(p_dados->>'caixa')::uuid
      and c.empresa_id=p_empresa and c.operador_id=suspensao.usuario_id and c.fechado_em is null for update;
    if not found then raise insufficient_privilege; end if;
    contado := (p_dados->>'contado')::bigint;
    esperado := painel_privado.fechar_turno_equipe(caixa,contado);
    perform painel_privado.auditar_desligamento(p_empresa,suspensao.id,p_acao,
      jsonb_build_object('caixa_id',caixa.id,'operador_id',caixa.operador_id,'contado',contado,'esperado',esperado));
    return jsonb_build_object('esperado',esperado);
  end if;

  if exists (select 1 from public.caixas c where c.empresa_id=p_empresa and c.operador_id=suspensao.usuario_id
    and c.fechado_em is null) then raise exception 'Reconcilie o turno antes de concluir o desligamento.'; end if;
  update painel_privado.suspensoes_equipe s set finalizado_por=auth.uid(),finalizado_em=now() where s.id=suspensao.id;
  perform painel_privado.auditar_desligamento(p_empresa,suspensao.id,p_acao,
    jsonb_build_object('usuario_id',suspensao.usuario_id));
  return jsonb_build_object('id',suspensao.id);
end;
$$;

create or replace function public.remover_operador_loja(p_empresa uuid,p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.operar_desligamento_equipe(p_empresa,'remover',jsonb_build_object('email',p_email));
end;
$$;

revoke all on function painel_privado.recusar_vinculo_suspenso(),
  painel_privado.bloquear_acesso_cozinha(uuid),painel_privado.invalidar_convites_desligamento(uuid,uuid,text),
  painel_privado.auditar_desligamento(uuid,uuid,text,jsonb),painel_privado.fechar_turno_equipe(public.caixas,bigint),
  public.operar_desligamento_equipe(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.operar_desligamento_equipe(uuid,text,jsonb) to authenticated;

commit;
