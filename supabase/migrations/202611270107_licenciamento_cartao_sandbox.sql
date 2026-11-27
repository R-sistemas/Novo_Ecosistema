begin;

alter table licenciamento_privado.cobrancas
  add column meio text not null default 'pix' check (meio in ('pix','cartao')),
  add column condicoes jsonb not null default '{}'::jsonb,
  add constraint licenca_condicoes_meio check (
    (meio='pix' and condicoes='{}'::jsonb)
    or (meio='cartao' and meses=6 and desconto_basis_points=0
      and jsonb_typeof(condicoes)='object' and condicoes ?& array['base','total','parcela','vezes','bandeira']
      and (condicoes->>'base')::int=valor_centavos
      and (condicoes->>'vezes')::int between 1 and 6
      and (condicoes->>'parcela')::int>0
      and case when (condicoes->>'vezes')::int=1 then (condicoes->>'total')::int=valor_centavos
        else (condicoes->>'total')::int>valor_centavos end) is true);

create function licenciamento_privado.reservar_cobranca(p_empresa uuid,p_gestor uuid,p_oferta uuid,p_termos text,
  p_requisicao uuid,p_provedor text,p_recebedor text,p_ambiente text,p_meio text,p_condicoes jsonb)
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
  desconto := case when p_meio='pix' then coalesce(o.desconto_pix_basis_points,0) else 0 end;
  insert into licenciamento_privado.cobrancas(empresa_id,gestor_id,requisicao_id,oferta_id,meses,termos_versao,
      base_centavos,desconto_basis_points,valor_centavos,revisao_contrato,inicio_vigencia,provedor,recebedor,ambiente,meio,condicoes)
    values(p_empresa,p_gestor,p_requisicao,p_oferta,o.meses,o.termos_versao,o.preco_centavos,desconto,
      greatest(1,round(o.preco_centavos::numeric*(10000-desconto)/10000)::int),c.revisao,c.valido_ate,p_provedor,p_recebedor,p_ambiente,p_meio,p_condicoes)
    returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.servico_licenca_reservar_pix(p_empresa uuid,p_gestor uuid,p_oferta uuid,p_termos text,
  p_requisicao uuid,p_provedor text,p_recebedor text,p_ambiente text)
returns jsonb language sql security definer set search_path='' as $$
  select licenciamento_privado.reservar_cobranca(p_empresa,p_gestor,p_oferta,p_termos,p_requisicao,
    p_provedor,p_recebedor,p_ambiente,'pix','{}'::jsonb);
$$;

create function public.servico_licenca_reservar_cartao(p_empresa uuid,p_gestor uuid,p_oferta uuid,p_termos text,
  p_requisicao uuid,p_provedor text,p_recebedor text,p_ambiente text,p_condicoes jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select licenciamento_privado.reservar_cobranca(p_empresa,p_gestor,p_oferta,p_termos,p_requisicao,
    p_provedor,p_recebedor,p_ambiente,'cartao',p_condicoes);
$$;

create function public.servico_licenca_observar_ordem(p_id uuid,p_provedor text,p_recebedor text,p_ambiente text,
  p_recurso text,p_valor int,p_evento text,p_tipo text,p_ocorrido timestamptz,p_meio text,p_condicoes jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare c licenciamento_privado.cobrancas;
begin
  select * into c from licenciamento_privado.cobrancas where id=p_id;
  if not found or c.meio is distinct from p_meio
    or (c.meio='cartao' and p_tipo in ('pago','revisao') and c.condicoes is distinct from p_condicoes) then
    return 'ignorado';
  end if;
  return public.servico_licenca_evento(p_id,p_provedor,p_recebedor,p_ambiente,p_recurso,p_valor,p_evento,p_tipo,p_ocorrido);
end;
$$;

revoke all on function licenciamento_privado.reservar_cobranca(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb),
  public.servico_licenca_reservar_cartao(uuid,uuid,uuid,text,uuid,text,text,text,jsonb),
  public.servico_licenca_observar_ordem(uuid,text,text,text,text,int,text,text,timestamptz,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.servico_licenca_reservar_cartao(uuid,uuid,uuid,text,uuid,text,text,text,jsonb),
  public.servico_licenca_observar_ordem(uuid,text,text,text,text,int,text,text,timestamptz,text,jsonb) to service_role;

create or replace function public.loja_licenca_resumo(p_empresa uuid)
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
    'cobranca_ativa',habilitada,'trial_fim',c.trial_fim,'valido_ate',c.valido_ate,'nao_renovar',c.nao_renovar,'revisao',c.revisao,
    'meses',(select meses from licenciamento_privado.ofertas where id=c.oferta_id),
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
