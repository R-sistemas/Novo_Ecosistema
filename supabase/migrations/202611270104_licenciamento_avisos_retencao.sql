begin;

create table licenciamento_privado.avisos (
  empresa_id uuid not null references licenciamento_privado.contratos(empresa_id),
  revisao integer not null,
  marco text not null,
  canal text not null check (canal in ('painel','email')),
  devido_em timestamptz not null,
  cancelado_em timestamptz,
  entregue_em timestamptz,
  primary key(empresa_id,revisao,marco,canal)
);
create index licenca_avisos_pendentes on licenciamento_privado.avisos(devido_em)
  where cancelado_em is null and entregue_em is null;

create table licenciamento_privado.revisoes_exclusao (
  empresa_id uuid not null references licenciamento_privado.contratos(empresa_id),
  corte timestamptz not null,
  elegivel_em timestamptz not null,
  estado text not null default 'avaliar_escopo' check (estado in ('avaliar_escopo','cancelada')),
  primary key(empresa_id,corte)
);
alter table licenciamento_privado.avisos enable row level security;
alter table licenciamento_privado.revisoes_exclusao enable row level security;
revoke all on licenciamento_privado.avisos,licenciamento_privado.revisoes_exclusao from public,anon,authenticated,service_role;

insert into painel_privado.capacidades_centrais values ('central.licencas.cancelar');
insert into painel_privado.capacidades_por_papel values ('central','central.licencas.cancelar');

create function licenciamento_privado.autorizacao_recente()
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array'
      then auth.jwt()->'amr' else '[]'::jsonb end) metodo
    where metodo->>'method' in ('password','totp')
      and case when metodo->>'timestamp' ~ '^[0-9]{1,12}$' then
        to_timestamp((metodo->>'timestamp')::double precision)
          between statement_timestamp()-interval '5 minutes' and statement_timestamp()
        else false end);
$$;
revoke all on function licenciamento_privado.autorizacao_recente() from public,anon,authenticated,service_role;

create function licenciamento_privado.cancelar(p_empresa uuid,p_modo text,p_revisao int,
  p_requisicao uuid,p_autor uuid,p_escopo text,p_motivo text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  c licenciamento_privado.contratos;
  a painel_privado.auditoria;
  antes jsonb;
  recibo jsonb;
  agora timestamptz := statement_timestamp();
begin
  if p_empresa is null or p_requisicao is null or p_revisao is null or p_modo is null
    or p_modo not in ('trial','nao_renovar') then
    raise exception using errcode='22023',message='Cancelamento inválido';
  end if;
  perform 1 from public.empresas where id=p_empresa for update;
  select * into a from painel_privado.auditoria where acao='licenca.cancelar'
    and escopo=p_escopo and requisicao_id=p_requisicao;
  if found then
    if a.autor_id=p_autor and a.entidade_id=p_empresa::text and a.depois->>'modo'=p_modo and
      (a.antes->>'revisao')::int=p_revisao and a.motivo is not distinct from p_motivo then return a.depois; end if;
    raise exception using errcode='23505',message='Requisição já utilizada';
  end if;
  select * into c from licenciamento_privado.contratos where empresa_id=p_empresa and politica='aniversario' for update;
  if not found then raise exception using errcode='P0002',message='Licença indisponível'; end if;
  if c.revisao<>p_revisao then raise exception using errcode='23505',message='Licença atualizada'; end if;
  antes := to_jsonb(c);
  if p_modo='trial' and c.fase='trial' and agora<c.trial_fim then
    update licenciamento_privado.contratos set fase='encerrada',nao_renovar=true,
      acesso_encerrado_em=agora,retencao_ate=agora,revisao=revisao+1 where empresa_id=p_empresa returning * into c;
  elsif p_modo='nao_renovar' and c.fase='ativa' and c.acesso_encerrado_em is null
    and not c.nao_renovar and agora < (c.valido_ate::timestamp at time zone 'America/Sao_Paulo')
    and exists(select 1 from licenciamento_privado.ofertas where id=c.oferta_id and meses=6) then
    update licenciamento_privado.contratos set nao_renovar=true,revisao=revisao+1 where empresa_id=p_empresa returning * into c;
  else raise exception using errcode='22023',message='Modalidade de cancelamento indisponível';
  end if;
  recibo := jsonb_build_object('requisicao',p_requisicao,'empresa',p_empresa,'modo',p_modo,'registrado_em',agora,
    'efeito_em',coalesce(c.acesso_encerrado_em,c.valido_ate::timestamp at time zone 'America/Sao_Paulo'),'revisao',c.revisao);
  insert into painel_privado.auditoria(autor_id,escopo,empresa_id,acao,entidade,entidade_id,antes,depois,motivo,requisicao_id)
    values(p_autor,p_escopo,case when p_escopo='loja' then p_empresa end,'licenca.cancelar','empresa',p_empresa::text,antes,recibo,p_motivo,p_requisicao);
  return recibo;
end;
$$;
create unique index licenca_cancelamento_requisicao on painel_privado.auditoria(escopo,requisicao_id)
  where acao='licenca.cancelar';

create function public.loja_licenca_cancelar(p_empresa uuid,p_modo text,p_revisao int,p_requisicao uuid,p_ciencia boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_empresa is null or p_ciencia is distinct from true or not licenciamento_privado.autorizacao_recente() then
    raise exception using errcode='42501',message='Confirme ciência e reautentique';
  end if;
  perform public.painel_contexto_sessao(p_empresa);
  return licenciamento_privado.cancelar(p_empresa,p_modo,p_revisao,p_requisicao,auth.uid(),'loja',null);
end;
$$;

create function public.central_licenca_cancelar(p_empresa uuid,p_modo text,p_revisao int,p_requisicao uuid,p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare autor uuid := painel_privado.central_autor('central.licencas.cancelar');
begin
  if p_motivo is null or length(btrim(p_motivo)) not between 1 and 240 then
    raise exception using errcode='22023',message='Motivo obrigatório';
  end if;
  return licenciamento_privado.cancelar(p_empresa,p_modo,p_revisao,p_requisicao,autor,'plataforma',btrim(p_motivo));
end;
$$;

create function licenciamento_privado.manutencao()
returns void language plpgsql set search_path = '' as $$
declare
  f licenciamento_privado.configuracao;
  agora timestamptz := statement_timestamp();
begin
  select * into f from licenciamento_privado.configuracao;
  with cortes as (
    select empresa_id,revisao,case when fase='trial' then trial_fim else least(invalido_em,
      (valido_ate+case when nao_renovar then 0 else 5 end)::timestamp at time zone 'America/Sao_Paulo') end corte
    from licenciamento_privado.contratos
    where politica='aniversario' and acesso_encerrado_em is null and fase in ('ativa','trial')
  )
  update licenciamento_privado.contratos c set acesso_encerrado_em=x.corte,
    retencao_ate=x.corte+case when c.fase='ativa' then interval '90 days' else interval '0' end,
    fase=case when c.fase='trial' or c.nao_renovar then 'encerrada' else c.fase end,
    revisao=c.revisao+1
  from cortes x where c.empresa_id=x.empresa_id and c.revisao=x.revisao and x.corte<=agora;

  update licenciamento_privado.avisos a set cancelado_em=agora
  from licenciamento_privado.contratos c where a.empresa_id=c.empresa_id and a.revisao<>c.revisao
    and a.cancelado_em is null and a.entregue_em is null;
  update licenciamento_privado.revisoes_exclusao e set estado='cancelada'
  from licenciamento_privado.contratos c where e.empresa_id=c.empresa_id
    and e.corte is distinct from c.acesso_encerrado_em and e.estado='avaliar_escopo';

  if f.avisos_ativos then
    insert into licenciamento_privado.avisos(empresa_id,revisao,marco,canal,devido_em)
    select c.empresa_id,c.revisao,m.marco,k.canal,m.devido
    from licenciamento_privado.contratos c
    left join licenciamento_privado.ofertas o on o.id=c.oferta_id
    cross join lateral (
      select 'trial_d'||d, c.trial_inicio+make_interval(hours=>24*(d-1))
        from unnest(array[1,5,7]) d where c.fase='trial' and c.acesso_encerrado_em is null
      union all
      select 'renovacao_d'||d, (c.valido_ate+d)::timestamp at time zone 'America/Sao_Paulo'
        from unnest(case o.meses when 6 then array[-30,-15,-5,0,2,4] else array[-5,-2,0,2,4] end) d
        where c.fase='ativa' and not c.nao_renovar and c.acesso_encerrado_em is null
      union all
      select 'exclusao_menos_'||d,c.retencao_ate-make_interval(days=>d)
        from unnest(array[30,15,7]) d where c.retencao_ate>coalesce(c.acesso_encerrado_em,agora)
    ) m(marco,devido)
    cross join (values ('painel'),('email')) k(canal)
    where c.politica='aniversario' and m.devido>=c.criado_em
    on conflict do nothing;
  end if;
  -- A janela só registra a elegibilidade. Os dados compartilhados exigem manifesto aprovado antes de qualquer exclusão.
  if f.exclusao_ativa then
    insert into licenciamento_privado.revisoes_exclusao(empresa_id,corte,elegivel_em)
      select empresa_id,acesso_encerrado_em,retencao_ate from licenciamento_privado.contratos
      where politica='aniversario' and retencao_ate<=agora on conflict do nothing;
  end if;
end;
$$;

create function public.loja_licenca_avisos(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_empresa is null then raise exception using errcode='22023',message='Empresa obrigatória'; end if;
  perform public.painel_contexto_sessao(p_empresa);
  return (select coalesce(jsonb_agg(to_jsonb(a) - 'empresa_id' order by a.devido_em),'[]'::jsonb) from (
    select i.marco,i.devido_em from licenciamento_privado.avisos i
    join licenciamento_privado.contratos c on c.empresa_id=i.empresa_id and c.revisao=i.revisao
    where i.empresa_id=p_empresa and i.canal='painel' and i.cancelado_em is null and i.devido_em<=statement_timestamp()
    order by i.devido_em desc limit 15) a);
end;
$$;

create function public.servico_licenca_manutencao()
returns void language sql security definer set search_path = '' as $$
  select licenciamento_privado.manutencao();
$$;

revoke all on all functions in schema licenciamento_privado from public,anon,authenticated,service_role;
revoke all on function public.loja_licenca_cancelar(uuid,text,int,uuid,boolean),public.central_licenca_cancelar(uuid,text,int,uuid,text),
  public.loja_licenca_avisos(uuid),public.servico_licenca_manutencao() from public,anon,authenticated,service_role;
grant execute on function public.loja_licenca_cancelar(uuid,text,int,uuid,boolean),public.central_licenca_cancelar(uuid,text,int,uuid,text),
  public.loja_licenca_avisos(uuid) to authenticated;
grant execute on function public.servico_licenca_manutencao() to service_role;

commit;
