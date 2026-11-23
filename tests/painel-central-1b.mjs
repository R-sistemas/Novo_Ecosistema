import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";

const { PGlite } = createRequire(import.meta.url)(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const id = n => "55000000-0000-0000-0000-" + String(n).padStart(12, "0");
const loja = id(1), outra = id(2), gestor = id(10), central = id(11), caixa = id(15), produto = id(16), pedido = id(17);
const item = JSON.stringify([{ produto_id: produto, quantidade: 1 }]);
const fechado = { code: "P0751" };

async function como(usuario, sql, valores = [], papel = "authenticated", aal = "aal2") {
  return db.transaction(async tx => {
    await tx.exec("set local role " + papel);
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: usuario, aal })]);
    return (await tx.query(sql, valores)).rows[0]?.dados;
  });
}
const rpc = (nome, valores, usuario = gestor, papel = "authenticated", aal) =>
  como(usuario, "select public." + nome + "(" + valores.map((_,i) => "$" + (i+1)).join(",") + ") dados", valores, papel, aal);
const aviso = (empresa = loja) => rpc("licenca_pdv", [empresa]);
const menu = (slug = "unidade-a") => rpc("ver_cardapio", [slug], null, "anon");
const enviar = (uuid = id(19)) => rpc("enviar_pedido", ["unidade-a", uuid, "Cliente fixture", null, item], null, "anon");

function atraso(dias) {
  return db.transaction(async tx => {
    await tx.exec("alter table painel_privado.central_licencas disable trigger central_validar_dia_vencimento");
    await tx.query(`insert into painel_privado.central_licencas (empresa_id,estado,vencimento,pagamento,revisao)
    values($1,'ativa',(now() at time zone 'America/Sao_Paulo')::date-$2::int,'pendente',1)
    on conflict(empresa_id) do update set vencimento=excluded.vencimento,pagamento='pendente'`,[loja,dias]);
    await tx.exec("alter table painel_privado.central_licencas enable trigger central_validar_dia_vencimento");
  });
}

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to authenticated,anon,service_role;
    create table auth.users(id uuid primary key,email text unique,invited_at timestamptz,raw_user_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
  `);
  const pasta = new URL("../supabase/migrations/", import.meta.url);
  for (const nome of (await readdir(pasta)).filter(n => n.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(nome,pasta),"utf8");
    await db.exec(sql);
  }
  await db.query("insert into auth.users values($1,'gestor@example.test'),($2,'central@example.test')",[gestor,central]);
  await db.query("insert into public.empresas(id,nome,cardapio_slug) values($1,'Unidade A','unidade-a'),($2,'Unidade B','unidade-b')",[loja,outra]);
  await db.query("insert into public.membros values($1,$2,'gestor')",[loja,gestor]);
  await db.query("insert into painel_privado.vinculos_centrais values($1,'central')",[central]);
  await db.query("insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos,ativo,visivel_cardapio) values($1,$2,'demo','Produto',100,true,true)",[produto,loja]);
  await db.query("insert into public.caixas(id,empresa_id,operador_id,abertura_centavos) values($1,$2,$3,0)",[caixa,loja,gestor]);
  await enviar(pedido);
  await db.query("insert into public.pix_frente_caixa(id,caixa_id,venda_id,ambiente,itens,valor_centavos,desconto_centavos) values($1,$2,$1,'sandbox','[]',100,0)",[id(18),caixa]);
});

after(() => db.close());

test("política civil: vencimento, carência, dia 4, dia 5 e ausência de licença", async () => {
  const { rows } = await db.query(`select d,efetivo from generate_series(0,6) d
    cross join lateral painel_privado.situacao_licenca(date '2026-11-20'-d,'pendente',date '2026-11-20',null) order by d`);
  assert.deepEqual(rows.map(r=>r.efetivo),["em_dia","em_debito","em_debito","em_debito","bloqueada_parcial","bloqueada_total","bloqueada_total"]);
  assert.equal((await menu()).fechado,false);
  assert.equal(await aviso(),"em_dia");
  assert.equal(await aviso(outra),null);
  await assert.rejects(rpc("licenca_pdv",[loja],null,"anon"),{code:"42501"});
  await atraso(3);
  assert.equal(await aviso(),"em_debito");
  await atraso(4);
  assert.equal(await aviso(),"bloqueada_parcial");
  const fechadoPublico=await menu();
  assert.equal(fechadoPublico.fechado,true);
  assert.deepEqual(fechadoPublico.produtos,[]);
  assert.ok(!("pagamento" in fechadoPublico));
  await assert.rejects(enviar(),fechado);
  assert.equal(await enviar(pedido),pedido);
  assert.equal((await menu("unidade-b")).fechado,false);
  await db.query("insert into public.caixas(id,empresa_id,operador_id,abertura_centavos,fechado_em,contado_centavos) values($1,$2,$3,0,now(),0)",[id(20),loja,gestor]);
  await atraso(5);
  assert.equal(await aviso(),"bloqueada_total");
  await assert.rejects(db.query("insert into public.caixas(id,empresa_id,operador_id,abertura_centavos) values($1,$2,$3,0)",[id(21),loja,gestor]),fechado);
  await assert.rejects(rpc("registrar_venda_com_desconto",[caixa,pedido,"dinheiro",item,0]),fechado);
  await assert.rejects(db.query("insert into public.pix_frente_caixa(id,caixa_id,venda_id,ambiente,itens,valor_centavos,desconto_centavos) values($1,$2,$1,'sandbox','[]',100,0)",[id(22),caixa]),fechado);
  assert.equal(await rpc("conciliar_pix_frente",[id(18),"ORDTST1",100,"sandbox","confirmado"],null,"service_role"),"confirmado");
  await db.query("update public.pedidos_online set estado='entregue' where id=$1",[pedido]);
  assert.equal(Number(await rpc("receber_comanda_conferida",[caixa,pedido,"dinheiro",100])),100);
  await db.query("update public.caixas set fechado_em=now(),contado_centavos=100 where id=$1",[caixa]);
  assert.equal((await db.query("select count(*)::int n from public.vendas where caixa_id=$1",[caixa])).rows[0].n,2);
});

test("ações manuais exigem MFA e capacidade, liberam e auditam sem duplicação", async () => {
  await atraso(6);
  const operacao="central_alterar_suspensao";
  const argumentos=[loja,"liberada",0,"Negociação",id(30)];
  await assert.rejects(rpc(operacao,argumentos),{code:"42501"});
  await assert.rejects(rpc(operacao,argumentos,central,"authenticated","aal1"),{code:"42501"});
  const salvo=await rpc(operacao,argumentos,central);
  assert.deepEqual(await rpc(operacao,argumentos,central),salvo);
  assert.equal(await aviso(),"em_debito");
  assert.equal((await menu()).fechado,false);
  assert.equal(await enviar(id(31)),id(31));
  const atencao=await rpc("central_empresas_atencao",["",1,20],central);
  assert.deepEqual(atencao.empresas.map(e=>[e.id,e.situacao,e.situacao_automatica]),[[loja,"em_debito","bloqueada_total"]]);
  await assert.rejects(rpc(operacao,[loja,"suspensa",0,"Expirou",id(32)],central),{code:"23505"});
  await rpc(operacao,[loja,"suspensa",1,"Negociação encerrada",id(33)],central);
  assert.equal(await aviso(),"bloqueada_total");
  await db.query("update painel_privado.central_licencas set pagamento='pago' where empresa_id=$1",[loja]);
  assert.equal(await aviso(),"bloqueada_total");
  await rpc(operacao,[loja,"automatico",2,"Pagamento confirmado",id(34)],central);
  assert.equal(await aviso(),"em_dia");
  assert.deepEqual((await rpc("central_empresas_atencao",["",1,20],central)).empresas,[]);
  const {rows}=await db.query("select autor_id,empresa_id,escopo,entidade_id,motivo from painel_privado.auditoria where acao='central.alterar_suspensao' order by ocorrido_em");
  assert.equal(rows.length,3);
  assert.ok(rows.every(e=>e.autor_id===central&&e.empresa_id===null&&e.escopo==="plataforma"&&e.entidade_id===loja));
});

test("checkout traduz a negativa do banco sem criar cobrança externa", async t => {
  const { checkout } = await import("../api/checkout-pix-mercado-pago-teste.mjs");
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/reservar_pix_mercado_pago_quiosque");
    return Response.json({code:"P0751", message:"Loja fechada para novos pedidos."}, {status:400});
  });
  const anteriorUrl=process.env.SUPABASE_URL, anteriorChave=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://fixture.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="somente-fixture";
  const res={setHeader(){},status(codigo){this.codigo=codigo;return this;},json(dados){this.dados=dados;return this;}};
  try {
    await checkout({method:"POST",body:{p_slug:"quiosque-dorafa",p_id:id(40),p_cliente:"Fixture",p_itens:JSON.parse(item)}},
      res,{sandbox:false,token:"somente-fixture"});
    assert.equal(res.codigo,409);
    assert.deepEqual(res.dados,{erro:"Loja fechada para novos pedidos.",codigo:"loja_fechada"});
    assert.equal(fetch.mock.callCount(),1);
  } finally {
    if(anteriorUrl===undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL=anteriorUrl;
    if(anteriorChave===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY=anteriorChave;
  }
});

test("MP fixa o recebedor de cada loja em Pix e cartão e recusa conciliação cruzada", async () => {
  const segredos = "v1." + "a".repeat(70);
  const firmas = [id(81),id(82)];
  const contas = [id(83),id(84)];
  const produtos = [id(85),id(86)];
  const pedidos = [id(87),id(88)];
  for (const [i,empresa] of firmas.entries()) {
    await db.query("insert into public.empresas(id,nome,cardapio_slug) values($1,$2,$3)",[empresa,"MP Fixture","recebedor-"+i]);
    await db.query("insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos,ativo,visivel_cardapio) values($1,$2,'mp','Item',100,true,true)",[produtos[i],empresa]);
    await db.query("insert into painel_privado.credenciais_mp(id,empresa_id,ambiente,recebedor,envelope,chave_publica,estado,revisao) values($1,$2,'producao',$3,$4,'publica','ativa',1)",[contas[i],empresa,String(900+i),segredos]);
    const opcao = await rpc("opcoes_mp_cardapio",["recebedor-"+i],null,"anon");
    assert.deepEqual(opcao,{ pix:true, credito:true, chave_publica:"publica" });
  }
  const reservar = (i) => rpc("servico_mp_reserva_pedido",["recebedor-"+i,pedidos[i],"Fixture",null,
    JSON.stringify([{produto_id:produtos[i],quantidade:1}]),i ? "credito" : "pix","producao"],null,"service_role");
  for (const i of [0,1]) {
    const reserva = await reservar(i);
    assert.equal(reserva.integracao,contas[i]);
    assert.equal(reserva.empresa,firmas[i]);
    assert.equal(reserva.recebedor,String(900+i));
  }
  const vincular = (conta,pedido,meio,ordem) => rpc("servico_mp_vincular_ordem",[conta,pedido,ordem,100,meio,true],null,"service_role");
  assert.equal(await vincular(contas[0],pedidos[1],"credito","ORD2"),false);
  assert.equal(await rpc("servico_mp_vincular_ordem",[contas[0],pedidos[0],"ORD1",99,"pix",true],null,"service_role"),false);
  assert.equal(await vincular(contas[0],pedidos[0],"pix","ORD1"),true);
  assert.equal(await vincular(contas[1],pedidos[1],"credito","ORD2"),true);
  await db.query("update painel_privado.credenciais_mp set estado='historica' where id=$1",[contas[0]]);
  await db.query("insert into painel_privado.credenciais_mp(id,empresa_id,ambiente,recebedor,envelope,chave_publica,estado,revisao) values($1,$2,'producao','990',$3,'publica','ativa',2)",[id(89),firmas[0],segredos]);
  assert.equal((await reservar(0)).integracao,contas[0]);
  assert.equal(await vincular(id(89),pedidos[0],"pix","ORD1"),false);
  assert.equal(await vincular(contas[0],pedidos[0],"pix","ORD1"),true);
  await assert.rejects(rpc("servico_integracao_mp_webhook",[contas[0]],null,"anon"),{code:"42501"});
});

test("fallback legado é fixado ao UUID e ao ambiente; Pix do caixa fixa a conta", async () => {
  const legado=id(91), produtoLegado=id(92), gestorLegado=id(93), caixaLegado=id(94);
  const empresaMP=id(81), contaMP=id(89), caixaMP=id(95), tentativa=id(96);
  await db.query("insert into auth.users(id,email) values($1,'legado@example.test')",[gestorLegado]);
  await db.query("insert into public.empresas(id,nome,cardapio_slug) values($1,'Legado','quiosque-dorafa')",[legado]);
  await db.query("insert into public.membros values($1,$2,'gestor'),($3,$2,'gestor')",[legado,gestorLegado,empresaMP]);
  await db.query("insert into public.provedores_pagamento(empresa_id,provedor,ambiente,pix_habilitado) values($1,'mercado_pago','producao',true)",[legado]);
  await db.query("insert into painel_privado.mp_legado_empresa values($1,'producao','quiosque-dorafa')",[legado]);
  await db.query("insert into public.produtos(id,empresa_id,codigo,nome,preco_centavos,ativo,visivel_cardapio) values($1,$2,'legado','Item',150,true,true)",[produtoLegado,legado]);
  await db.query("insert into public.caixas(id,empresa_id,operador_id,abertura_centavos) values($1,$2,$3,0),($4,$5,$3,0)",[caixaLegado,legado,gestorLegado,caixaMP,empresaMP]);
  const reservarLegado = (slug, ambiente) => rpc("servico_mp_reserva_pedido",[slug,id(97),"Fixture",null,
    JSON.stringify([{produto_id:produtoLegado,quantidade:1}]),"pix",ambiente,null,null,true],null,"service_role");
  assert.deepEqual(await reservarLegado("quiosque-dorafa","producao"),{ legado:true,pedido:{total_centavos:150,cobranca:null} });
  await assert.rejects(reservarLegado("quiosque-dorafa","sandbox"),{code:"23505"});
  assert.deepEqual(await reservarLegado("nao-e-legado","producao"),{ bloqueada:true });
  await db.query("insert into public.pix_frente_caixa(id,caixa_id,venda_id,ambiente,itens,valor_centavos,desconto_centavos) values($1,$2,$1,'producao','[]',100,0)",[tentativa,caixaMP]);
  const rota = await rpc("servico_mp_reserva_pdv",[tentativa],null,"service_role");
  assert.equal(rota.integracao,contaMP);
  await assert.rejects(rpc("conciliar_pix_frente",[tentativa,"ORD9",100,"producao","aguardando"],null,"service_role"),{code:"42501"});
  await assert.rejects(rpc("servico_mp_conciliar_pdv",[id(84),tentativa,"ORD9",100,"producao","aguardando"],null,"service_role"),{code:"42501"});
  assert.equal(await rpc("servico_mp_conciliar_pdv",[contaMP,tentativa,"ORD9",100,"producao","aguardando"],null,"service_role"),"aguardando");
});
