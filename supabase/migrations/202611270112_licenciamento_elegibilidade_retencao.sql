begin;

alter table licenciamento_privado.revisoes_exclusao
  drop constraint revisoes_exclusao_estado_check,
  add constraint revisoes_exclusao_estado_check check (estado in ('avaliar_escopo','bloqueada_financeiro','cancelada')),
  add column revisao_contrato int,
  add column tipo_retencao text check (tipo_retencao in ('trial','paga_90d')),
  add column protecao jsonb not null default '{}'::jsonb;

-- O registro documenta elegibilidade. Não há função de eliminação de dados.
create or replace function licenciamento_privado.manutencao()
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
    and e.corte is distinct from c.acesso_encerrado_em and e.estado in ('avaliar_escopo','bloqueada_financeiro');

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
  if f.exclusao_ativa then
    insert into licenciamento_privado.revisoes_exclusao as registro
      (empresa_id,corte,elegivel_em,estado,revisao_contrato,tipo_retencao,protecao)
    select c.empresa_id,c.acesso_encerrado_em,c.retencao_ate,
      case when exists(select 1 from licenciamento_privado.cobrancas p
        where p.empresa_id=c.empresa_id and p.estado in ('pendente','revisao'))
        then 'bloqueada_financeiro' else 'avaliar_escopo' end,
      c.revisao,case when c.retencao_ate>c.acesso_encerrado_em then 'paga_90d' else 'trial' end,
      jsonb_build_object('antifraude_meses',12,'preservar_trial_minimo',true,
        'preservar_obrigacoes_legais',true,'preservar_dados_compartilhados',true)
    from licenciamento_privado.contratos c
    where c.politica='aniversario' and c.retencao_ate<=agora
    on conflict (empresa_id,corte) do update set estado=excluded.estado,
      revisao_contrato=excluded.revisao_contrato,tipo_retencao=excluded.tipo_retencao,protecao=excluded.protecao
    where registro.estado<>'cancelada' and (
      registro.estado,registro.revisao_contrato,registro.tipo_retencao,registro.protecao)
      is distinct from (excluded.estado,excluded.revisao_contrato,excluded.tipo_retencao,excluded.protecao);
  end if;
end;
$$;

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
    'cobranca_ativa',habilitada,'retencao_ate',c.retencao_ate,'trial_fim',c.trial_fim,'valido_ate',c.valido_ate,'nao_renovar',c.nao_renovar,'revisao',c.revisao,
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

commit;
