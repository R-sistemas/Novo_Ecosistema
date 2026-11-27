begin;

alter table licenciamento_privado.configuracao add column mudancas_ativas boolean not null default false;
create table licenciamento_privado.mudancas (
  id uuid primary key,
  empresa_id uuid not null references licenciamento_privado.contratos(empresa_id),
  gestor_id uuid not null,
  oferta_anterior uuid not null references licenciamento_privado.ofertas(id),
  oferta_nova uuid not null references licenciamento_privado.ofertas(id),
  termos text not null,
  efetiva_em date not null,
  criada_em timestamptz not null default statement_timestamp(),
  confirmada_em timestamptz,
  cobranca uuid unique references licenciamento_privado.cobrancas(id),
  unique (empresa_id,efetiva_em)
);
alter table licenciamento_privado.mudancas enable row level security;
revoke all on licenciamento_privado.mudancas from public,anon,authenticated,service_role;
alter table licenciamento_privado.cobrancas add column mudanca_id uuid references licenciamento_privado.mudancas(id);

create function licenciamento_privado.oferta_operacional(c licenciamento_privado.contratos)
returns uuid language sql stable set search_path='' as $$
  select coalesce((
    select m.oferta_anterior from licenciamento_privado.mudancas m
    where m.empresa_id=c.empresa_id and m.oferta_nova=c.oferta_id and m.confirmada_em is not null
      and m.efetiva_em>(statement_timestamp() at time zone 'America/Sao_Paulo')::date
    order by m.efetiva_em asc limit 1
  ),c.oferta_id);
$$;

create function public.loja_licenca_programar_mudanca(p_empresa uuid,p_oferta uuid,p_termos text,p_requisicao uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c licenciamento_privado.contratos;
  o licenciamento_privado.ofertas;
  m licenciamento_privado.mudancas;
  gestor uuid := auth.uid();
begin
  if p_empresa is null or p_requisicao is null then raise exception using errcode='22023',message='Mudança inválida'; end if;
  perform public.painel_contexto_sessao(p_empresa);
  perform 1 from public.empresas where id=p_empresa for update;
  select * into m from licenciamento_privado.mudancas where id=p_requisicao;
  if found then
    if m.empresa_id=p_empresa and m.gestor_id=gestor and m.oferta_nova=p_oferta and m.termos=p_termos then
      return jsonb_build_object('oferta',m.oferta_nova,'efetiva_em',m.efetiva_em,'paga',m.confirmada_em is not null);
    end if;
    raise exception using errcode='23505',message='Requisição já utilizada';
  end if;
  if not exists(select 1 from licenciamento_privado.configuracao where mudancas_ativas and cobranca_ativa) then
    raise exception using errcode='42501',message='Mudança indisponível';
  end if;
  select * into c from licenciamento_privado.contratos where empresa_id=p_empresa and politica='aniversario' for update;
  if not found or c.fase<>'ativa' or c.nao_renovar
    or licenciamento_privado.estado_operacional(c,statement_timestamp())<>'valida'
    or exists(select 1 from licenciamento_privado.cobrancas where empresa_id=p_empresa and estado in ('pendente','revisao')) then
    raise exception using errcode='23505',message='Licença indisponível para mudança';
  end if;
  select * into o from licenciamento_privado.ofertas where id=p_oferta and comercializavel and termos_versao=p_termos;
  if not found or c.oferta_id=o.id then raise exception using errcode='22023',message='Selecione outra oferta vigente'; end if;
  insert into licenciamento_privado.mudancas(id,empresa_id,gestor_id,oferta_anterior,oferta_nova,termos,efetiva_em)
    values(p_requisicao,p_empresa,gestor,c.oferta_id,o.id,o.termos_versao,c.valido_ate) returning * into m;
  update licenciamento_privado.contratos set revisao=revisao+1 where empresa_id=p_empresa;
  insert into painel_privado.auditoria(autor_id,escopo,empresa_id,acao,entidade,entidade_id,depois,requisicao_id)
    values(gestor,'loja',p_empresa,'licenca.mudanca_programada','empresa',p_empresa::text,
      jsonb_build_object('oferta',o.id,'efetiva_em',m.efetiva_em),p_requisicao);
  return jsonb_build_object('oferta',m.oferta_nova,'efetiva_em',m.efetiva_em,'paga',false);
end;
$$;

create or replace function licenciamento_privado.reservar_cobranca(p_empresa uuid,p_gestor uuid,p_oferta uuid,p_termos text,
  p_requisicao uuid,p_provedor text,p_recebedor text,p_ambiente text,p_meio text,p_condicoes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c licenciamento_privado.contratos;
  o licenciamento_privado.ofertas;
  r licenciamento_privado.cobrancas;
  desconto int;
  mudanca licenciamento_privado.mudancas;
  hoje date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists(select 1 from licenciamento_privado.configuracao where cobranca_ativa)
    or not exists(select 1 from public.membros m where m.empresa_id=p_empresa and m.usuario_id=p_gestor and m.papel='gestor') then
    raise exception using errcode='42501',message='Cobrança indisponível';
  end if;
  perform 1 from public.empresas where id=p_empresa for update;
  select * into c from licenciamento_privado.contratos where empresa_id=p_empresa and politica='aniversario' for update;
  if not found then raise exception using errcode='P0002',message='Licença indisponível'; end if;
  select * into r from licenciamento_privado.cobrancas where empresa_id=p_empresa and requisicao_id=p_requisicao;
  if found then
    if r.gestor_id=p_gestor and r.oferta_id=p_oferta and r.termos_versao=p_termos
      and r.provedor=p_provedor and r.recebedor=p_recebedor and r.ambiente=p_ambiente and r.meio=p_meio and r.condicoes=p_condicoes then return to_jsonb(r); end if;
    raise exception using errcode='23505',message='Requisição já utilizada';
  end if;
  select * into o from licenciamento_privado.ofertas where id=p_oferta and comercializavel and termos_versao=p_termos;
  if not found then raise exception using errcode='22023',message='Oferta indisponível'; end if;
  if c.fase='encerrada' or c.nao_renovar or (c.fase='trial' and c.trial_fim<=statement_timestamp())
    or (c.valido_ate is not null and hoje >= licenciamento_privado.data_aniversario(c.valido_ate,c.ancora_dia,o.meses))
    or (c.valido_ate is not null and hoje < c.valido_ate - case when o.meses=1 then 5 else 15 end) then
    raise exception using errcode='23505',message='Cobrança fora da janela';
  end if;
  if p_meio='cartao' and (o.meses<>6 or (p_condicoes->>'base')::int is distinct from o.preco_centavos
    or p_ambiente<>'sandbox') then
    raise exception using errcode='22023',message='Cotação ou modalidade indisponível';
  end if;
  if c.fase='ativa' then
    select * into mudanca from licenciamento_privado.mudancas
      where empresa_id=p_empresa and efetiva_em=c.valido_ate and confirmada_em is null;
    if found and mudanca.oferta_nova<>o.id then
      raise exception using errcode='23505',message='Pagamento deve usar a oferta da mudança programada';
    elsif not found and c.oferta_id<>o.id
      and licenciamento_privado.estado_operacional(c,statement_timestamp())<>'restrita' then
      raise exception using errcode='23505',message='Programe a mudança para o fim do período';
    end if;
  end if;
  desconto := case when p_meio='pix' then coalesce(o.desconto_pix_basis_points,0) else 0 end;
  insert into licenciamento_privado.cobrancas(empresa_id,gestor_id,requisicao_id,oferta_id,meses,termos_versao,
      base_centavos,desconto_basis_points,valor_centavos,revisao_contrato,inicio_vigencia,provedor,recebedor,ambiente,meio,condicoes,mudanca_id)
    values(p_empresa,p_gestor,p_requisicao,p_oferta,o.meses,o.termos_versao,o.preco_centavos,desconto,
      greatest(1,round(o.preco_centavos::numeric*(10000-desconto)/10000)::int),c.revisao,c.valido_ate,p_provedor,p_recebedor,p_ambiente,p_meio,p_condicoes,mudanca.id)
    returning * into r;
  return to_jsonb(r);
end;
$$;

create function licenciamento_privado.confirmar_mudanca()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update licenciamento_privado.mudancas set confirmada_em=new.confirmado_em,cobranca=new.id
    where id=new.mudanca_id and empresa_id=new.empresa_id and oferta_nova=new.oferta_id
      and efetiva_em=new.inicio_vigencia and confirmada_em is null;
  if not found then raise exception 'Vínculo da mudança de plano inconsistente'; end if;
  return new;
end;
$$;
create trigger licenca_confirmar_mudanca after update of estado on licenciamento_privado.cobrancas
for each row when (new.mudanca_id is not null and new.estado='confirmado' and old.estado is distinct from new.estado)
execute function licenciamento_privado.confirmar_mudanca();

create function licenciamento_privado.agendar_sem_mudanca()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from licenciamento_privado.mudancas where empresa_id=new.empresa_id
    and efetiva_em=new.vigencia and confirmada_em is null) then return null; end if;
  return new;
end;
$$;
create trigger licenca_agendar_sem_mudanca before insert on licenciamento_privado.agenda_pix
for each row execute function licenciamento_privado.agendar_sem_mudanca();

create or replace function public.loja_licenca_resumo(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c licenciamento_privado.contratos;
  habilitada boolean;
  atual licenciamento_privado.ofertas;
  mudanca licenciamento_privado.mudancas;
begin
  perform public.painel_contexto_sessao(p_empresa);
  if p_empresa is null then raise exception using errcode='22023',message='Empresa obrigatória'; end if;
  select * into c from licenciamento_privado.contratos where empresa_id=p_empresa and politica='aniversario';
  if not found then return null; end if;
  select cobranca_ativa into habilitada from licenciamento_privado.configuracao;
  select * into atual from licenciamento_privado.ofertas where id=licenciamento_privado.oferta_operacional(c);
  select * into mudanca from licenciamento_privado.mudancas where empresa_id=p_empresa
    and (confirmada_em is null or efetiva_em>(statement_timestamp() at time zone 'America/Sao_Paulo')::date)
    order by criada_em desc limit 1;
  return jsonb_build_object('fase',c.fase,'situacao',licenciamento_privado.estado_operacional(c,statement_timestamp()),
    'cobranca_ativa',habilitada,'trial_fim',c.trial_fim,'valido_ate',c.valido_ate,'nao_renovar',c.nao_renovar,'revisao',c.revisao,
    'meses',atual.meses,'plano',atual.plano,'oferta_atual',atual.id,
    'mudancas_ativas',(select mudancas_ativas from licenciamento_privado.configuracao),
    'mudanca',case when mudanca.id is null then null else jsonb_build_object(
      'oferta',mudanca.oferta_nova,'efetiva_em',mudanca.efetiva_em,'paga',mudanca.confirmada_em is not null) end,
    'ofertas',case when habilitada then (
      select coalesce(jsonb_agg(to_jsonb(o)-'comercializavel' order by o.plano,o.meses,o.versao),'[]'::jsonb)
      from licenciamento_privado.ofertas o where comercializavel) else '[]'::jsonb end,
    'historico',(select coalesce(jsonb_agg(to_jsonb(h) order by h.criado_em desc),'[]'::jsonb)
      from (select id,estado,valor_centavos,meses,criado_em,confirmado_em,vigencia_aplicada,meio,
        case when gestor_id=auth.uid() and meio='pix' and estado='pendente' then
          jsonb_build_object('requisicao',requisicao_id,'oferta',oferta_id,'termos',termos_versao) end retomar
        from licenciamento_privado.cobrancas where empresa_id=p_empresa order by criado_em desc limit 30) h));
end;
$$;

revoke all on all functions in schema licenciamento_privado from public,anon,authenticated,service_role;
revoke all on function public.loja_licenca_programar_mudanca(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.loja_licenca_programar_mudanca(uuid,uuid,text,uuid) to authenticated;
commit;
