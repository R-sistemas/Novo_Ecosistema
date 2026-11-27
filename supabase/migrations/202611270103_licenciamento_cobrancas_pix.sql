begin;

create table licenciamento_privado.cobrancas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references licenciamento_privado.contratos(empresa_id),
  gestor_id uuid not null,
  requisicao_id uuid not null,
  oferta_id uuid not null references licenciamento_privado.ofertas(id),
  meses smallint not null check (meses in (1,6)),
  termos_versao text not null,
  base_centavos integer not null check (base_centavos > 0),
  desconto_basis_points integer not null check (desconto_basis_points between 0 and 9999),
  valor_centavos integer not null check (valor_centavos > 0),
  revisao_contrato integer not null,
  inicio_vigencia date,
  provedor text not null,
  recebedor text not null,
  ambiente text not null check (ambiente in ('sandbox','producao')),
  recurso text,
  estado text not null default 'pendente' check (estado in ('pendente','confirmado','revisao','encerrado','estornado','contestado')),
  criado_em timestamptz not null default statement_timestamp(),
  confirmado_em timestamptz,
  vigencia_aplicada date,
  unique(empresa_id,requisicao_id),
  unique(provedor,recebedor,ambiente,recurso)
);
create unique index licenca_uma_cobranca_pendente on licenciamento_privado.cobrancas(empresa_id)
  where estado in ('pendente','revisao');
create table licenciamento_privado.eventos_financeiros (
  cobranca_id uuid not null references licenciamento_privado.cobrancas(id),
  evento text not null,
  ocorrido_em timestamptz not null,
  tipo text not null check (tipo in ('pago','encerrado','estornado','contestado','parcial')),
  primary key(cobranca_id,evento)
);
alter table licenciamento_privado.cobrancas enable row level security;
alter table licenciamento_privado.eventos_financeiros enable row level security;
revoke all on licenciamento_privado.cobrancas,licenciamento_privado.eventos_financeiros from public,anon,authenticated,service_role;

insert into painel_privado.capacidades_centrais values ('central.licencas.catalogo');
insert into painel_privado.capacidades_por_papel values ('central','central.licencas.catalogo');

create function public.central_licenca_publicar_oferta(p_plano text,p_versao int,p_meses smallint,
  p_preco int,p_desconto int,p_termos text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  oferta licenciamento_privado.ofertas;
  autor uuid := painel_privado.central_autor('central.licencas.catalogo');
begin
  if not exists(select 1 from licenciamento_privado.configuracao where admissao_ativa) then
    raise exception using errcode='42501',message='Catálogo indisponível';
  end if;
  insert into licenciamento_privado.ofertas(plano,versao,meses,preco_centavos,desconto_pix_basis_points,termos_versao,comercializavel)
    values(p_plano,p_versao,p_meses,p_preco,p_desconto,p_termos,true) returning * into oferta;
  insert into painel_privado.auditoria(autor_id,escopo,acao,entidade,entidade_id,depois,requisicao_id)
    values(autor,'plataforma','central.licenca_oferta','oferta',oferta.id::text,to_jsonb(oferta),oferta.id);
  return oferta.id;
end;
$$;

create function public.loja_licenca_resumo(p_empresa uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c licenciamento_privado.contratos;
  habilitada boolean;
begin
  perform public.painel_contexto_sessao(p_empresa);
  if p_empresa is null then raise exception using errcode='22023',message='Empresa obrigatória'; end if;
  select * into c from licenciamento_privado.contratos where empresa_id=p_empresa and politica='aniversario';
  if not found then return null; end if;
  select cobranca_ativa into habilitada from licenciamento_privado.configuracao;
  return jsonb_build_object('fase',c.fase,'situacao',licenciamento_privado.estado_operacional(c,statement_timestamp()),
    'trial_fim',c.trial_fim,'valido_ate',c.valido_ate,'nao_renovar',c.nao_renovar,'revisao',c.revisao,
    'ofertas',case when habilitada then (
      select coalesce(jsonb_agg(to_jsonb(o)-'comercializavel' order by o.plano,o.meses,o.versao),'[]'::jsonb)
      from licenciamento_privado.ofertas o where comercializavel) else '[]'::jsonb end,
    'historico',(select coalesce(jsonb_agg(to_jsonb(h) order by h.criado_em desc),'[]'::jsonb)
      from (select id,estado,valor_centavos,meses,criado_em,confirmado_em,vigencia_aplicada
        from licenciamento_privado.cobrancas where empresa_id=p_empresa order by criado_em desc limit 30) h));
end;
$$;

create function public.servico_licenca_reservar_pix(p_empresa uuid,p_gestor uuid,p_oferta uuid,p_termos text,
  p_requisicao uuid,p_provedor text,p_recebedor text,p_ambiente text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c licenciamento_privado.contratos;
  o licenciamento_privado.ofertas;
  r licenciamento_privado.cobrancas;
  desconto int;
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
      and r.provedor=p_provedor and r.recebedor=p_recebedor and r.ambiente=p_ambiente then return to_jsonb(r); end if;
    raise exception using errcode='23505',message='Requisição já utilizada';
  end if;
  select * into o from licenciamento_privado.ofertas where id=p_oferta and comercializavel and termos_versao=p_termos;
  if not found then raise exception using errcode='22023',message='Oferta indisponível'; end if;
  if c.fase='encerrada' or c.nao_renovar or (c.fase='trial' and c.trial_fim<=statement_timestamp())
    or (c.valido_ate is not null and hoje >= licenciamento_privado.data_aniversario(c.valido_ate,c.ancora_dia,o.meses))
    or (c.valido_ate is not null and hoje < c.valido_ate - case when o.meses=1 then 5 else 15 end) then
    raise exception using errcode='23505',message='Cobrança fora da janela';
  end if;
  desconto := coalesce(o.desconto_pix_basis_points,0);
  insert into licenciamento_privado.cobrancas(empresa_id,gestor_id,requisicao_id,oferta_id,meses,termos_versao,
      base_centavos,desconto_basis_points,valor_centavos,revisao_contrato,inicio_vigencia,provedor,recebedor,ambiente)
    values(p_empresa,p_gestor,p_requisicao,p_oferta,o.meses,o.termos_versao,o.preco_centavos,desconto,
      greatest(1,round(o.preco_centavos::numeric*(10000-desconto)/10000)::int),c.revisao,c.valido_ate,p_provedor,p_recebedor,p_ambiente)
    returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.servico_licenca_evento(p_id uuid,p_provedor text,p_recebedor text,p_ambiente text,
  p_recurso text,p_valor int,p_evento text,p_tipo text,p_ocorrido timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r licenciamento_privado.cobrancas;
  c licenciamento_privado.contratos;
  base date;
  ancora smallint;
  validade date;
begin
  select * into r from licenciamento_privado.cobrancas where id=p_id;
  if not found then return 'ignorado'; end if;
  perform 1 from public.empresas where id=r.empresa_id for update;
  select * into r from licenciamento_privado.cobrancas where id=p_id for update;
  if (r.provedor,r.recebedor,r.ambiente,r.valor_centavos) is distinct from (p_provedor,p_recebedor,p_ambiente,p_valor)
    or nullif(p_recurso,'') is null or (r.recurso is not null and r.recurso<>p_recurso) then return 'ignorado'; end if;
  update licenciamento_privado.cobrancas set recurso=p_recurso where id=p_id;
  if p_tipo='vinculo' then return r.estado; end if;
  insert into licenciamento_privado.eventos_financeiros values(p_id,p_evento,p_ocorrido,p_tipo)
    on conflict do nothing;
  if not found then return r.estado; end if;
  select * into c from licenciamento_privado.contratos where empresa_id=r.empresa_id for update;
  if p_tipo in ('estornado','contestado') then
    update licenciamento_privado.cobrancas set estado=p_tipo where id=p_id;
    if r.vigencia_aplicada=c.valido_ate then
      update licenciamento_privado.contratos set invalido_em=least(coalesce(invalido_em,p_ocorrido),p_ocorrido),revisao=revisao+1 where empresa_id=c.empresa_id;
    end if;
    return p_tipo;
  elsif p_tipo='encerrado' then
    update licenciamento_privado.cobrancas set estado='encerrado' where id=p_id and estado='pendente';
    return 'encerrado';
  elsif p_tipo<>'pago' then return r.estado;
  end if;
  if r.vigencia_aplicada is not null or r.estado in ('estornado','contestado') then return r.estado; end if;
  base := coalesce(r.inicio_vigencia,(p_ocorrido at time zone 'America/Sao_Paulo')::date);
  ancora := coalesce(c.ancora_dia,extract(day from base)::smallint);
  validade := licenciamento_privado.data_aniversario(base,ancora,r.meses);
  if r.estado<>'pendente' or c.revisao<>r.revisao_contrato or c.fase='encerrada' or c.nao_renovar
    or (c.fase='trial' and p_ocorrido>=c.trial_fim)
    or validade<=(p_ocorrido at time zone 'America/Sao_Paulo')::date then
    update licenciamento_privado.cobrancas set estado='revisao',confirmado_em=p_ocorrido where id=p_id;
    return 'revisao';
  end if;
  update licenciamento_privado.contratos set fase='ativa',oferta_id=r.oferta_id,ancora_dia=ancora,valido_ate=validade,
    invalido_em=null,acesso_encerrado_em=null,retencao_ate=null,revisao=revisao+1 where empresa_id=c.empresa_id;
  update licenciamento_privado.cobrancas set estado='confirmado',confirmado_em=p_ocorrido,vigencia_aplicada=validade where id=p_id;
  return 'confirmado';
end;
$$;

revoke all on function public.central_licenca_publicar_oferta(text,int,smallint,int,int,text),public.loja_licenca_resumo(uuid),
  public.servico_licenca_reservar_pix(uuid,uuid,uuid,text,uuid,text,text,text),
  public.servico_licenca_evento(uuid,text,text,text,text,int,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.central_licenca_publicar_oferta(text,int,smallint,int,int,text),public.loja_licenca_resumo(uuid) to authenticated;
grant execute on function public.servico_licenca_reservar_pix(uuid,uuid,uuid,text,uuid,text,text,text),
  public.servico_licenca_evento(uuid,text,text,text,text,int,text,text,timestamptz) to service_role;

commit;
