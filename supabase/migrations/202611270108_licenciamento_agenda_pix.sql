begin;

alter table licenciamento_privado.configuracao add column agenda_ativa boolean not null default false;
alter table licenciamento_privado.cobrancas add column origem text not null default 'gestor'
  check (origem in ('gestor','agenda'));
create table licenciamento_privado.agenda_pix (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references licenciamento_privado.contratos(empresa_id),
  vigencia date not null,
  revisao int not null,
  nova_tentativa_em timestamptz not null default statement_timestamp(),
  lease uuid,
  lease_ate timestamptz,
  finalizado_em timestamptz,
  unique (empresa_id,vigencia,revisao)
);
alter table licenciamento_privado.agenda_pix enable row level security;
revoke all on licenciamento_privado.agenda_pix from public,anon,authenticated,service_role;

create function public.servico_licenca_agendar_pix(p_recebedor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  item licenciamento_privado.agenda_pix;
  c licenciamento_privado.contratos;
  o licenciamento_privado.ofertas;
  gestor uuid;
  r jsonb;
  hoje date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
  agora timestamptz := statement_timestamp();
begin
  perform licenciamento_privado.manutencao();
  if not exists(select 1 from licenciamento_privado.configuracao where agenda_ativa and cobranca_ativa) then
    return null;
  end if;
  insert into licenciamento_privado.agenda_pix(empresa_id,vigencia,revisao)
  select contrato.empresa_id,contrato.valido_ate,contrato.revisao from licenciamento_privado.contratos contrato
  join licenciamento_privado.ofertas oferta on oferta.id=contrato.oferta_id and oferta.meses=1 and oferta.comercializavel
  where contrato.politica='aniversario' and contrato.fase='ativa' and contrato.invalido_em is null and contrato.acesso_encerrado_em is null
    and not contrato.nao_renovar and hoje between contrato.valido_ate-5 and contrato.valido_ate+4
  on conflict do nothing;
  select a.* into item from licenciamento_privado.agenda_pix a
  where finalizado_em is null and nova_tentativa_em<=agora and (lease_ate is null or lease_ate<=agora)
    and not exists(select 1 from licenciamento_privado.cobrancas p
      where p.empresa_id=a.empresa_id and p.estado in ('pendente','revisao') and p.requisicao_id<>a.id)
  order by a.nova_tentativa_em,a.id limit 1 for update of a skip locked;
  if not found then return null; end if;
  perform 1 from public.empresas where id=item.empresa_id for update;
  select * into c from licenciamento_privado.contratos where empresa_id=item.empresa_id;
  select * into o from licenciamento_privado.ofertas where id=c.oferta_id;
  select m.usuario_id into gestor from public.membros m where m.empresa_id=c.empresa_id and m.papel='gestor'
    order by m.usuario_id limit 1;
  if c.revisao is distinct from item.revisao or c.valido_ate is distinct from item.vigencia
    or c.nao_renovar or c.fase<>'ativa' or c.invalido_em is not null or c.acesso_encerrado_em is not null
    or not coalesce(o.comercializavel and o.meses=1,false) or gestor is null
    or not (hoje between c.valido_ate-5 and c.valido_ate+4)
    or exists(select 1 from licenciamento_privado.cobrancas p
      where p.empresa_id=item.empresa_id and p.estado in ('pendente','revisao') and p.requisicao_id<>item.id) then
    update licenciamento_privado.agenda_pix set finalizado_em=agora where id=item.id;
    return null;
  end if;
  select to_jsonb(p) into r from licenciamento_privado.cobrancas p
    where p.empresa_id=item.empresa_id and p.requisicao_id=item.id and p.origem='agenda'
      and p.provedor='mercado_pago' and p.ambiente='sandbox' and p.recebedor=p_recebedor;
  if not found then
    r:=licenciamento_privado.reservar_cobranca(c.empresa_id,gestor,o.id,o.termos_versao,item.id,
      'mercado_pago',p_recebedor,'sandbox','pix','{}');
    update licenciamento_privado.cobrancas set origem='agenda' where id=(r->>'id')::uuid;
  end if;
  update licenciamento_privado.agenda_pix set lease=gen_random_uuid(),lease_ate=agora+interval '2 minutes'
    where id=item.id returning * into item;
  return jsonb_build_object('id',item.id,'lease',item.lease,'cobranca',r);
end;
$$;

create function public.servico_licenca_fechar_agenda(p_id uuid,p_lease uuid,p_concluida boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update licenciamento_privado.agenda_pix set lease=null,lease_ate=null,
    finalizado_em=case when p_concluida then statement_timestamp() end,
    nova_tentativa_em=statement_timestamp()+interval '5 minutes'
    where id=p_id and lease=p_lease and finalizado_em is null;
  return found;
end;
$$;

-- Configuração explícita da futura janela. A migration não instala extensões nem ativa jobs.
create function licenciamento_privado.configurar_cron(p_ativo boolean)
returns void language plpgsql set search_path='' as $$
begin
  if p_ativo then
    perform cron.schedule('licenciamento-v2-sandbox','*/5 * * * *',
      $tarefa$select net.http_post(
        url:=(select decrypted_secret from vault.decrypted_secrets where name='licenciamento_sandbox_worker_url'),
        headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret
          from vault.decrypted_secrets where name='licenciamento_sandbox_worker_secret')),
        timeout_milliseconds:=30000
      )$tarefa$);
  elsif exists(select 1 from cron.job where jobname='licenciamento-v2-sandbox') then
    perform cron.unschedule('licenciamento-v2-sandbox');
  end if;
end;
$$;
revoke all on function licenciamento_privado.configurar_cron(boolean),
  public.servico_licenca_agendar_pix(text),public.servico_licenca_fechar_agenda(uuid,uuid,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.servico_licenca_agendar_pix(text),
  public.servico_licenca_fechar_agenda(uuid,uuid,boolean) to service_role;

commit;
