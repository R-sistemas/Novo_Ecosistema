-- Execute com conexão privilegiada. Os dados de teste são revertidos.
begin;
do $$
declare
  gestor uuid:=gen_random_uuid(); vendas_id uuid:=gen_random_uuid(); cozinha_id uuid:=gen_random_uuid();
  loja uuid:=gen_random_uuid(); outra uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values (gestor,'gestor-lista@example.invalid'),
    (vendas_id,'vendas-lista@example.invalid'),(cozinha_id,'cozinha-lista@example.invalid');
  insert into public.empresas(id,nome) values(loja,'Loja de teste'),(outra,'Outra loja');
  insert into public.membros(empresa_id,usuario_id,papel) values(loja,gestor,'gestor');

  set local role service_role;
  perform public.vincular_novo_usuario_kds(gestor,loja,cozinha_id);
  perform public.vincular_novo_operador_pdv(gestor,loja,vendas_id,'Caixa 01');
  begin
    perform public.vincular_novo_usuario_kds(gestor,outra,cozinha_id);
    raise exception 'Vínculo indevido em outra loja';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',gestor::text,true);
  if not exists(select 1 from public.membros where empresa_id=loja and usuario_id=gestor and papel='gestor') then
    raise exception 'A sessão do gestor não encontrou o próprio vínculo';
  end if;
  if (select count(*) from public.listar_operadores_gestor(loja))<>2
    or not exists(select 1 from public.listar_operadores_gestor(loja)
      where email='cozinha-lista@example.invalid' and cozinha and not edita_comanda and not vendas)
    or not exists(select 1 from public.listar_operadores_gestor(loja)
      where email='vendas-lista@example.invalid' and vendas and caixas=array['Caixa 01']) then
    raise exception 'Lista ou papéis incorretos';
  end if;
  perform public.configurar_edicao_kds(loja,'cozinha-lista@example.invalid',true);
  if not exists(select 1 from public.listar_operadores_gestor(loja) where cozinha and edita_comanda) then
    raise exception 'Permissão não apareceu na lista';
  end if;
  perform set_config('request.jwt.claim.sub',vendas_id::text,true);
  begin
    perform public.listar_operadores_gestor(loja);
    raise exception 'Operador acessou a lista administrativa';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;
select 'OK cadastro por serviço, lista e isolamento por perfil e loja' as validacao;
rollback;
