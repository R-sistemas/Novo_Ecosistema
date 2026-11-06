begin;

create function public.avancar_solicitacao_remo(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from remo.operadores where usuario_id = auth.uid()) then
    raise exception 'Acesso à central REMO indisponível.';
  end if;
  update remo.solicitacoes set estado = p_estado
    where id = p_id and (
      (estado = 'solicitada' and p_estado in ('aceita','cancelada'))
      or (estado = 'aceita' and p_estado in ('em_rota','cancelada'))
      or (estado = 'em_rota' and p_estado = 'entregue')
    );
  if not found then raise exception 'Solicitação indisponível ou transição inválida.'; end if;
end;
$$;

revoke execute on function public.avancar_solicitacao_remo(uuid,text) from public, anon, authenticated;
grant execute on function public.avancar_solicitacao_remo(uuid,text) to authenticated;

commit;
