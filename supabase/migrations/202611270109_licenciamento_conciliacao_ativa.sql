begin;

alter table licenciamento_privado.configuracao add column conciliacao_ativa boolean not null default false;
alter table licenciamento_privado.cobrancas
  add column proxima_consulta timestamptz not null default statement_timestamp(),
  add column consulta_lease uuid,
  add column consulta_ate timestamptz,
  add column consultas_falhas int not null default 0;
create index licenca_consultas_pendentes on licenciamento_privado.cobrancas(proxima_consulta,id)
  where ambiente='sandbox' and estado in ('pendente','revisao','confirmado');

create function public.servico_licenca_puxar_conciliacao(p_recebedor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reservada licenciamento_privado.cobrancas;
begin
  if not exists(select 1 from licenciamento_privado.configuracao where conciliacao_ativa) then return null; end if;
  with tarefa as (
    select p.id from licenciamento_privado.cobrancas p
    join licenciamento_privado.contratos c on c.empresa_id=p.empresa_id
    where p.provedor='mercado_pago' and p.ambiente='sandbox' and p.recebedor=p_recebedor
      and (p.estado in ('pendente','revisao') or (p.estado='confirmado' and p.vigencia_aplicada=c.valido_ate))
      and p.proxima_consulta<=statement_timestamp() and coalesce(p.consulta_ate,'-infinity')<=statement_timestamp()
    order by p.proxima_consulta,p.id limit 1 for update of p skip locked
  )
  update licenciamento_privado.cobrancas p set consulta_lease=gen_random_uuid(),
    consulta_ate=statement_timestamp()+interval '2 minutes' from tarefa where p.id=tarefa.id
    returning p.* into reservada;
  if not found then return null; end if;
  return to_jsonb(reservada);
end;
$$;

create function public.servico_licenca_fechar_conciliacao(p_id uuid,p_lease uuid,p_observada boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update licenciamento_privado.cobrancas set consulta_lease=null,consulta_ate=null,
    consultas_falhas=case when p_observada then 0 else least(consultas_falhas+1,10) end,
    proxima_consulta=statement_timestamp()+
      case when estado='confirmado' and p_observada then interval '1 day'
        when p_observada then interval '5 minutes'
        else make_interval(mins=>least(60,5*(consultas_falhas+1))) end
    where id=p_id and consulta_lease=p_lease;
  return found;
end;
$$;

create function public.servico_licenca_ler_cobranca(p_empresa uuid,p_gestor uuid,p_id uuid,p_recebedor text)
returns jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(c) from licenciamento_privado.cobrancas c
  where c.empresa_id=p_empresa and c.id=p_id and c.ambiente='sandbox' and c.provedor='mercado_pago'
    and c.recebedor=p_recebedor and exists(select 1 from public.membros m
      where m.empresa_id=p_empresa and m.usuario_id=p_gestor and m.papel='gestor');
$$;

revoke all on function public.servico_licenca_puxar_conciliacao(text),
  public.servico_licenca_fechar_conciliacao(uuid,uuid,boolean),
  public.servico_licenca_ler_cobranca(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.servico_licenca_puxar_conciliacao(text),
  public.servico_licenca_fechar_conciliacao(uuid,uuid,boolean),
  public.servico_licenca_ler_cobranca(uuid,uuid,uuid,text) to service_role;
commit;
