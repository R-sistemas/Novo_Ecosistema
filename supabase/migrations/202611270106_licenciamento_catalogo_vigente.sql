begin;

create unique index licenca_oferta_vigente on licenciamento_privado.ofertas(plano,meses)
  where comercializavel;

create or replace function public.central_licenca_publicar_oferta(p_plano text,p_versao int,p_meses smallint,
  p_preco int,p_desconto int,p_termos text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  oferta licenciamento_privado.ofertas;
  autor uuid := painel_privado.central_autor('central.licencas.catalogo');
begin
  if not exists(select 1 from licenciamento_privado.configuracao where admissao_ativa) then
    raise exception using errcode='42501',message='Catálogo indisponível';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_plano,p_meses));
  if exists(select 1 from licenciamento_privado.ofertas
    where plano=p_plano and meses=p_meses and versao>=p_versao) then
    raise exception using errcode='23505',message='Versão de oferta já utilizada ou superada';
  end if;
  update licenciamento_privado.ofertas set comercializavel=false
    where plano=p_plano and meses=p_meses and comercializavel;
  insert into licenciamento_privado.ofertas(plano,versao,meses,preco_centavos,desconto_pix_basis_points,termos_versao,comercializavel)
    values(p_plano,p_versao,p_meses,p_preco,p_desconto,p_termos,true) returning * into oferta;
  insert into painel_privado.auditoria(autor_id,escopo,acao,entidade,entidade_id,depois,requisicao_id)
    values(autor,'plataforma','central.licenca_oferta','oferta',oferta.id::text,to_jsonb(oferta),oferta.id);
  return oferta.id;
end;
$$;

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
      from (select id,estado,valor_centavos,meses,criado_em,confirmado_em,vigencia_aplicada,
        case when gestor_id=auth.uid() and estado='pendente' then
          jsonb_build_object('requisicao',requisicao_id,'oferta',oferta_id,'termos',termos_versao) end retomar
        from licenciamento_privado.cobrancas where empresa_id=p_empresa order by criado_em desc limit 30) h));
end;
$$;

commit;
