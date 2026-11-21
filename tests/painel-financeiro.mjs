import { csvFinanceiro } from "../admin/regras/financeiro-csv.mjs";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { before, after, test } from "node:test";
import handler from "../api/cadastrar-operador.mjs";
import { receberNotificacao } from "../api/mercado-pago-teste-webhook.mjs";
import { createHmac } from "node:crypto";

const require = createRequire(import.meta.url);
const {PGlite} = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname,"..");
const uid = n => "50000000-0000-0000-0000-" + String(n).padStart(12,"0");
const a = uid(101), b = uid(102), vazia = uid(103);
const usuarios = {a:uid(201),b:uid(202),op:uid(203)};
const dia = "2026-11-20", seguinte = "2026-11-21";
const config = JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon,authenticated,service_role;
  `);
  const pasta = resolve(root,"supabase/migrations");
  for (const nome of (await readdir(pasta)).filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve(pasta,nome),"utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${usuarios.a}','a@teste.invalid'),
      ('${usuarios.b}','b@teste.invalid'), ('${usuarios.op}','op@teste.invalid');
    insert into empresas(id,nome,cardapio_slug) values ('${a}','Loja A','quiosque-dorafa'),
      ('${b}','Loja B','b'), ('${vazia}','Vazia','vazia');
    insert into membros(empresa_id,usuario_id,papel) values
      ('${a}','${usuarios.a}','gestor'), ('${b}','${usuarios.b}','gestor'),
      ('${vazia}','${usuarios.a}','gestor'), ('${a}','${usuarios.op}','operador');
    insert into provedores_pagamento(empresa_id,provedor,ambiente) values
      ('${a}','mercado_pago','producao'), ('${a}','provedor_b','producao'),
      ('${a}','provedor_b','sandbox'), ('${b}','provedor_b','producao');
    insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,estado)
    select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      case when n=29 then '${b}' else '${a}' end::uuid, 'Cliente privado', '[]', 1000,
      case when n=2 then 'recusado' when n=3 then 'entregue' else 'novo' end
    from generate_series(1,30) n;
    insert into entregas_pedido(pedido_id,endereco,pagamento,frete_centavos)
      values ('${uid(3)}','{"telefone":"segredo"}','online',230);
    insert into cancelamentos_comanda(id,pedido_id,solicitado_por,motivo,estado)
      values ('${uid(91)}','${uid(4)}','${usuarios.a}','Teste','cancelado');
    insert into pagamentos_online(pedido_id,empresa_id,provedor,ambiente,meio,valor_centavos,cobranca_id,confirmado_em)
    select p.id,p.empresa_id,case when n<=13 then 'mercado_pago' else 'provedor_b' end,
      case when n=27 then 'sandbox' else 'producao' end,
      (array['pix','credito','debito'])[1+(n-1)%3], n*100,
      case when n<>30 then 'tx-'||n end,
      case when n=30 then null when n=28 then '2026-11-21 03:00+00'::timestamptz
        else '2026-11-21 02:00+00'::timestamptz end
    from generate_series(1,30) n
    join pedidos_online p on p.id=('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
    insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,criado_em)
    select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      case when n=128 then '${b}' else '${a}' end::uuid,'Cliente privado','[]',1000,
      case when n=129 then now() - interval '2 minutes'
        when n=130 then now() - interval '1 hour' else '2026-11-21 02:00+00'::timestamptz end
    from generate_series(104,131) n;
    insert into pagamentos_online(pedido_id,empresa_id,provedor,ambiente,meio,valor_centavos,cobranca_id)
    select p.id,p.empresa_id,case when n=130 then 'mercado_pago' else 'provedor_b' end,
      case when n=127 then 'sandbox' else 'producao' end,'pix',1000,
      case when n=130 then 'ORDFIXTURE' when n<>131 then 'pendente-'||n end
    from generate_series(104,131) n
    join pedidos_online p on p.id=('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
    insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,criado_em)
    select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${a}','Cliente privado','[]',1000,
      '2026-11-21 02:00+00'::timestamptz from generate_series(132,134) n;
    insert into pagamentos_online(pedido_id,empresa_id,provedor,ambiente,meio,valor_centavos,cobranca_id)
    select p.id,p.empresa_id,'provedor_b','producao','debito',1000,'pendente-'||n
    from generate_series(132,134) n join pedidos_online p
      on p.id=('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
  `);
});
after(() => db.close());

async function rpc(token, nome, args, papel = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec("set local role " + papel);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [usuarios[token] ?? "",papel]);
    const consulta = args.map((_,i) => "$" + (i+1)).join(",");
    return (await tx.query("select public." + nome + "(" + consulta + ") dados",args)).rows[0].dados;
  });
}
const resumo = (token,empresa,inicio=dia,fim=inicio) => rpc(token,"painel_financeiro_resumo",[empresa,inicio,fim]);
const extrato = (pagina,tamanho) => rpc("a","painel_financeiro_extrato",[a,dia,dia,pagina,tamanho]);

test("PGlite: produção confirmada, fuso civil, totais bigint, frete e provedores",async () => {
  const dados = await resumo("a",a);
  assert.equal(dados.quantidade,26);
  assert.equal(dados.total_centavos,"35100");
  assert.equal(dados.frete_centavos,"230");
  assert.equal(dados.taxa_centavos,null);
  assert.equal(dados.liquido_centavos,null);
  assert.deepEqual(dados.meios,{pix:"11700",credito:"12600",debito:"10800"});
  assert.deepEqual(dados.provedores,{mercado_pago:"9100",provedor_b:"26000"});
  assert.deepEqual(dados.canais,{cardapio:"34800",entrega:"300",pdv:"0"});
  assert.deepEqual(dados.dias,[{dia,total_centavos:"35100"}]);
  assert.equal((await resumo("a",a,seguinte)).total_centavos,"2800");
  assert.equal((await resumo("a",a,"2026-11-19",dia)).dias[0].total_centavos,"0");
  assert.equal((await resumo("a",vazia)).quantidade,0);
  assert.equal((await resumo("b",b)).total_centavos,"2900");
});

test("PGlite: isolamento, perfis, grants, limites e paginação estável sem PII",async () => {
  for (const [token,empresa] of [["a",b],["b",a],["op",a]]) {
    await assert.rejects(resumo(token,empresa),{code:"42501"});
    await assert.rejects(rpc(token,"painel_financeiro_extrato",[empresa,dia,dia,1,25]),{code:"42501"});
  }
  for (const papel of ["anon","service_role"]) {
    await assert.rejects(rpc("a","painel_financeiro_resumo",[a,dia,dia],papel),{code:"42501"});
  }
  await assert.rejects(resumo("a",a,"2024-01-01",dia),{code:"22023"});
  await assert.rejects(extrato(1,101),{code:"22023"});
  const [primeira,segunda] = [await extrato(1,25),await extrato(2,25)];
  assert.equal(primeira.tem_proxima,true);
  assert.equal(segunda.tem_proxima,false);
  const linhas = [...primeira.transacoes,...segunda.transacoes];
  assert.deepEqual(linhas.map(t => t.pedido_id),Array.from({length:26},(_,i) => uid(26-i)));
  assert.deepEqual(linhas.slice(-4).map(t => t.estado),["cancelado","entregue","recusado","pago"]);
  assert.deepEqual(Object.keys(linhas[0]).sort(),[
    "canal","confirmado_em","estado","estado_psp","frete_centavos","liquido_centavos","meio","pedido_id",
    "provedor","referencia","taxa_centavos","valor_centavos"
  ]);
  assert.equal(linhas[0].taxa_centavos,null);
  assert.equal(linhas[0].liquido_centavos,null);
  assert.deepEqual((await extrato(3,25)).transacoes,[]);
});

const conciliar = (token,empresa,inicio=dia,fim=inicio,pagina=1,tamanho=25) =>
  rpc(token,"painel_financeiro_conciliacao",[empresa,inicio,fim,pagina,tamanho]);

test("Conciliação: fila paginada por idade, sem reserva, confirmação, sandbox ou outra loja",async () => {
  const [primeira,segunda] = [await conciliar("a",a),await conciliar("a",a,dia,dia,2)];
  assert.equal(primeira.confirmadas,26);
  assert.equal(primeira.confirmadas_centavos,"35100");
  assert.equal(primeira.pendentes_total,26);
  assert.equal(primeira.tem_proxima,true);
  assert.equal(segunda.tem_proxima,false);
  assert.equal(primeira.eventos_webhook,0);
  assert.equal(primeira.divergencias,null);
  assert.equal(primeira.estornos_cancelamentos,null);
  const linhas = [...primeira.pendentes,...segunda.pendentes];
  assert.deepEqual(linhas.map(x=>x.pedido_id),[134,133,132,...Array.from({length:23},(_,i)=>126-i)].map(uid));
  assert.deepEqual(Object.keys(linhas[0]).sort(),["meio","pedido_criado_em","pedido_id","provedor","referencia","valor_centavos"]);
  assert.equal((await conciliar("b",b)).pendentes_total,1);
  assert.equal((await conciliar("a",vazia)).pendentes_total,0);
  await assert.rejects(conciliar("a",b),{code:"42501"});
  await assert.rejects(conciliar("op",a),{code:"42501"});
  await assert.rejects(conciliar("a",a,"2025-11-20",dia),{code:"22023"});
  await assert.rejects(conciliar("a",a,dia,dia,1,101),{code:"22023"});
  for (const papel of ["anon","service_role"]) {
    await assert.rejects(rpc("a","painel_financeiro_conciliacao",[a,dia,dia],papel),{code:"42501"});
  }
  const datas=(await db.query(`select to_char((now() at time zone 'America/Sao_Paulo')::date,'YYYY-MM-DD') hoje,
    to_char((now() at time zone 'America/Sao_Paulo')::date - 1,'YYYY-MM-DD') ontem`)).rows[0];
  const recentes=await conciliar("a",a,datas.ontem,datas.hoje,1,100);
  assert.ok(recentes.pendentes.some(p=>p.pedido_id===uid(130)));
  assert.ok(!recentes.pendentes.some(p=>p.pedido_id===uid(129)));
});

function assinaturaWebhook(id,body) {
  const segredo="segredo-fixture", ts=String(Date.now()), requestId="fixture";
  const assinatura=createHmac("sha256",segredo).update("id:"+id.toLowerCase()+";request-id:"+requestId+";ts:"+ts+";").digest("hex");
  return {method:"POST",query:{"data.id":id},body,
    headers:{"x-request-id":requestId,"x-signature":"ts="+ts+",v1="+assinatura}};
}
async function webhook(id,body,altera=req=>req) {
  const res={status(code){this.code=code;return this;},end(){}};
  await receberNotificacao(altera(assinaturaWebhook(id,body)),res,{segredo:"segredo-fixture",token:"fixture",sandbox:false});
  return res.code;
}
const argumentosEvento=["p_pedido","p_provedor","p_ambiente","p_cobranca","p_evento","p_estado","p_valor","p_ocorrido_em","p_estornado"];
const gravarEvento=(p,role="service_role")=>rpc(null,"registrar_evento_financeiro_psp",argumentosEvento.map(k=>p[k] ?? null),role);
const limparEventos=()=>db.exec("delete from painel_privado.financeiro_eventos_psp where evento_id ~ '^(order|payment|chargeback):'");

test("Webhook Orders: confirmação precede auditoria, recupera falha, deduplica e ignora metadados do corpo",async t => {
  process.env.SUPABASE_URL="https://banco.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY="fixture";
  const ordem="ORDFIXTURE", pedido=uid(130);
  let falha=true, estado="processed", detalhe="accredited", refunds;
  const data=new Date().toISOString();
  const chamadas=[];
  t.mock.method(globalThis,"fetch",async (url,init) => {
    const u=new URL(url);
    if(u.hostname==="api.mercadopago.com"){
      assert.equal(u.pathname,"/v1/orders/"+ordem);
      return Response.json({id:ordem,external_reference:pedido,status:estado,status_detail:detalhe,
        last_updated_date:data,total_amount:"10.00",
        transactions:{refunds,payments:[{amount:"10.00",status:estado,payment_method:{id:"pix",type:"bank_transfer"}}]}});
    }
    const nome=u.pathname.split("/").at(-1), p=JSON.parse(init.body);
    chamadas.push(nome);
    if(nome==="registrar_evento_financeiro_psp"){
      if(falha)return new Response(null,{status:503});
      assert.equal(p.p_pedido,pedido);
      return Response.json(await gravarEvento(p));
    }
    assert.equal(nome,"atualizar_pix_mercado_pago_quiosque");
    return Response.json(await rpc(null,nome,[p.p_pedido,p.p_cobranca,p.p_valor,p.p_confirmado],"service_role"));
  });
  const falso={id:"corpo-fixture",date_created:"1990-01-01T12:00:00Z",data:{external_reference:uid(999),status:"refunded"}};
  try {
    assert.equal(await webhook(ordem,falso),200);
    assert.deepEqual(chamadas.slice(0,2),["atualizar_pix_mercado_pago_quiosque","registrar_evento_financeiro_psp"]);
    const {confirmado,criado}=(await db.query(`select
      to_char(pg.confirmado_em at time zone 'America/Sao_Paulo','YYYY-MM-DD') confirmado,
      to_char(p.criado_em at time zone 'America/Sao_Paulo','YYYY-MM-DD') criado
      from pagamentos_online pg join pedidos_online p on p.id=pg.pedido_id where pg.pedido_id=$1`,[pedido])).rows[0];
    assert.ok(confirmado);
    const local=await conciliar("a",a,criado,confirmado,1,100);
    assert.ok(!local.pendentes.some(p=>p.pedido_id===pedido));
    assert.ok(local.confirmadas>=1);
    assert.equal(local.conciliadas,null);
    falha=false;
    assert.equal(await webhook(ordem,falso),200);
    assert.equal(await webhook(ordem,{...falso,id:"outra-entrega"}),200);
    const observado=await conciliar("a",a,criado,confirmado);
    assert.equal(observado.eventos_webhook,1);
    assert.equal(observado.conciliadas,1);
    assert.equal((await conciliar("b",b,criado,confirmado)).eventos_webhook,0);
    estado="provedor_novo";detalhe="sem_mapeamento";
    assert.equal(await webhook(ordem,falso),200);
    assert.equal((await db.query("select count(*)::int n from painel_privado.financeiro_eventos_psp where estado='desconhecido'")).rows[0].n,1);
    estado="processed";detalhe="partially_refunded";
    refunds=[{id:"refund-1",status:"processed",amount:"2.01"}];
    assert.equal(await webhook(ordem,falso),200);
    const parcial=await db.query("select estornado_centavos::text valor from painel_privado.financeiro_eventos_psp where estado='estorno_parcial'");
    assert.equal(parcial.rows[0].valor,"201");
    refunds.push({id:"refund-1",status:"processed",amount:"2.01"});
    assert.equal(await webhook(ordem,falso),200);
    assert.equal((await db.query("select count(*)::int n from painel_privado.financeiro_eventos_psp where estado='estorno_parcial' and estornado_centavos is null")).rows[0].n,1);
    assert.equal(await webhook(ordem,{},req=>({...req,headers:{}})),401);
  } finally { await limparEventos(); }
});

test("Payments e contestações: consulta autenticada e vínculo estrito, sem confirmar fluxo legado",async t => {
  process.env.SUPABASE_URL="https://banco.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY="fixture";
  const id="123456", caso="456789", pedido=uid(9);
  const data="2026-11-21T01:10:00Z";
  const recebido=[];
  await db.query("update pagamentos_online set cobranca_id=$1 where pedido_id=$2",[id,pedido]);
  t.mock.method(globalThis,"fetch",async (url,init) => {
    const path=new URL(url).pathname;
    if(path==="/v1/payments/"+id)return Response.json({
      id:Number(id),live_mode:true,currency_id:"BRL",external_reference:pedido,
      transaction_amount:9,transaction_amount_refunded:2.01,status:"approved",date_last_updated:data
    });
    if(path==="/users/me")return Response.json({id:42});
    if(path==="/v1/chargebacks/"+caso){
      assert.equal(init.headers["X-Caller-Id"],"42");
      return Response.json({id:caso,payments:[Number(id)],currency:"BRL",amount:"2.01",date_last_updated:data});
    }
    assert.equal(path,"/rest/v1/rpc/registrar_evento_financeiro_psp");
    const p=JSON.parse(init.body);
    recebido.push(p);
    return Response.json(await gravarEvento(p));
  });
  try {
    assert.equal(await webhook(id,{type:"payment",action:"payment.updated"}),200);
    assert.equal(await webhook(caso,{type:"chargebacks",action:"order.charged_back"}),200);
    assert.equal(await webhook("80",{type:"unknown"}),200);
    assert.deepEqual(recebido.map(e=>[e.p_estado,e.p_valor,e.p_cobranca]),[
      ["estorno_parcial","900",id],["contestacao","900",id]
    ]);
    assert.equal((await conciliar("a",a)).eventos_webhook,2);
    assert.equal((await conciliar("b",b)).eventos_webhook,0);
    const [e]=recebido;
    assert.equal(await gravarEvento({...e,p_ambiente:"sandbox",p_evento:"fixture-errado"}),false);
    assert.equal(await gravarEvento({...e,p_pedido:uid(29),p_evento:"fixture-errado"}),false);
    for(const role of ["anon","authenticated"]){
      await assert.rejects(gravarEvento(e,role),{code:"42501"});
    }
  } finally {
    await limparEventos();
    await db.query("update pagamentos_online set cobranca_id='tx-9' where pedido_id=$1",[pedido]);
  }
});

test("Conciliação: última observação compara valores e status; estornos deduplicados e sandbox excluído",async () => {
  await db.exec(`
    insert into painel_privado.financeiro_eventos_psp values
    ('${a}','provedor_b','producao','tx-14','rep-1','2026-11-21 01:05+00','confirmado',1400),
    ('${a}','provedor_b','producao','tx-14','rep-2','2026-11-21 01:06+00','estorno_parcial',1400),
    ('${a}','provedor_b','producao','tx-14','rep-3','2026-11-21 01:07+00','estornado',1400),
    ('${a}','provedor_b','producao','tx-15','rep-4','2026-11-21 02:00+00','confirmado',1501),
    ('${a}','provedor_b','producao','pendente-104','rep-5','2026-11-21 02:00+00','confirmado',1000),
    ('${a}','provedor_b','producao','pendente-105','rep-8','2026-11-21 01:59+00','cancelado',1000),
    ('${b}','provedor_b','producao','tx-29','rep-6','2026-11-21 02:00+00','confirmado',2900),
    ('${a}','provedor_b','sandbox','pendente-127','rep-7','2026-11-21 02:00+00','estornado',1000);
  `);
  try {
    const dados=await conciliar("a",a);
    assert.equal(dados.eventos_webhook,6);
    assert.equal(dados.divergencias,4);
    assert.equal(dados.estornos_cancelamentos,2);
    assert.equal(dados.conciliadas,0);
    assert.equal(dados.divergencias_recentes.length,4);
    assert.ok(dados.divergencias_recentes.some(d=>d.valor_local_centavos==="1500"&&d.valor_psp_centavos==="1501"));
    assert.equal(dados.estornos_cancelamentos_recentes[1].estado_psp,"estornado");
    assert.ok(!JSON.stringify(dados).includes("cobranca_id"));
    assert.equal((await conciliar("b",b)).conciliadas,1);
  } finally {
    await db.exec("delete from painel_privado.financeiro_eventos_psp where evento_id like 'rep-%'");
  }
});

function eventoPeriodo(n, estado, estornado, ocorridoEm, versao=1) {
  return gravarEvento({p_pedido:uid(n),p_provedor:n<=13?"mercado_pago":"provedor_b",
    p_ambiente:n===27?"sandbox":"producao",p_cobranca:"tx-"+n,p_evento:"reversao-"+n+"-"+versao,
    p_estado:estado,p_valor:String(n*100),p_ocorrido_em:ocorridoEm,p_estornado:estornado});
}

test("Consolidação: estorno incremental, cancelamento e disputa distintos; monta extrato/CSV sem PII",async () => {
  try {
    await eventoPeriodo(14,"estorno_parcial","100","2026-11-20T02:55:00Z");
    await eventoPeriodo(14,"estorno_parcial","300","2026-11-21T01:10:00Z",2);
    await eventoPeriodo(14,"estornado","1400","2026-11-21T02:00:00Z",3);
    await eventoPeriodo(14,"estornado","1400","2026-11-21T02:05:00Z",4);
    await eventoPeriodo(15,"contestacao",null,"2026-11-21T02:06:00Z");
    await eventoPeriodo(1,"confirmado","0","2026-11-21T01:00:00Z");
    await eventoPeriodo(1,"estorno_parcial","40","2026-11-21T02:05:00Z",2);
    await eventoPeriodo(2,"cancelado",null,"2026-11-21T02:06:00Z");
    await eventoPeriodo(27,"estornado","2700","2026-11-21T02:06:00Z");
    await eventoPeriodo(29,"contestacao",null,"2026-11-21T02:06:00Z");
    await eventoPeriodo(15,"estornado","1500","2026-11-21T03:01:00Z",2);
    const r=await resumo("a",a);
    assert.equal(r.total_centavos,"35100");
    assert.equal(r.taxa_centavos,null);
    assert.equal(r.liquido_centavos,null);
    assert.equal(r.reversoes.estornado_centavos,"1340");
    assert.equal(r.reversoes.estornos,2);
    assert.equal(r.reversoes.contestacoes,1);
    assert.equal(r.reversoes.cancelamentos,1);
    assert.equal(r.reversoes.provedores.provedor_b.estornado_centavos,"1300");
    assert.equal(r.reversoes.provedores.mercado_pago.estornado_centavos,"40");
    assert.equal((await resumo("b",b)).reversoes.contestacoes,1);
    assert.equal((await resumo("a",vazia)).reversoes.estornado_centavos,null);
    const {transacoes}=await rpc("a","painel_financeiro_exportar",[a,dia,dia]);
    assert.equal(transacoes.length,26);
    const estado=n=>transacoes.find(t=>t.pedido_id===uid(n))?.estado_psp;
    assert.deepEqual([estado(1),estado(2),estado(14),estado(15),estado(26)],
      ["estorno_parcial","cancelado","estornado","contestacao",null]);
    assert.deepEqual((await extrato(1,25)).transacoes,transacoes.slice(0,25));
    assert.ok(!JSON.stringify(transacoes).includes("cobranca_id"));
    await assert.rejects(rpc("b","painel_financeiro_exportar",[a,dia,dia]),{code:"42501"});
    await assert.rejects(rpc("a","painel_financeiro_exportar",[a,dia,dia],"anon"),{code:"42501"});
    await eventoPeriodo(16,"estorno_parcial","20","2026-11-21T02:06:00Z");
    assert.equal((await resumo("a",a)).reversoes.estornado_centavos,null);
    assert.equal((await resumo("a",a)).reversoes.sem_valor,1);
    await eventoPeriodo(14,"contestacao",null,"2026-11-21T02:07:00Z",5);
    await eventoPeriodo(14,"estorno_parcial","600","2026-11-21T02:08:00Z",6);
    assert.equal((await resumo("a",a)).reversoes.sem_valor,2);
  } finally {
    await db.exec("delete from painel_privado.financeiro_eventos_psp where evento_id like 'reversao-%'");
  }
});

test("CSV: UTF-8, vírgula, aspas, acentos, ausência nula e fórmula neutralizada",() => {
  const csv=csvFinanceiro([{referencia:'Mesa, "Ação"',provedor:"=1+1",valor_centavos:"9007199254740993"}]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Mesa, ""Ação"""'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"9007199254740993"'));
  assert.equal(csv.split("\r\n").length,3);
  assert.ok(!csv.includes("null")&&!csv.includes("undefined"));
});

function simular(t) {
  process.env.SUPABASE_URL = "https://banco.example";
  process.env.SUPABASE_ANON_KEY = "fixture";
  let falhar = "";
  t.mock.method(globalThis,"fetch",async (url,init) => {
    const token = init.headers.Authorization?.split(" ")[1];
    if (!Object.hasOwn(usuarios,token)) return new Response(null,{status:401});
    const nome = new URL(url).pathname.split("/").at(-1);
    if (nome === "user") return Response.json({id:usuarios[token]});
    const p = JSON.parse(init.body);
    try {
      if (nome === "painel_contexto_sessao") return Response.json(await rpc(token,nome,[p.p_empresa_id]));
      if (nome === "painel_listar_produtos") return Response.json({produtos:[]});
      if (falhar && nome.endsWith(falhar)) {
        falhar = "";
        return new Response(null,{status:502});
      }
      assert.match(nome,/^painel_financeiro_(resumo|extrato|conciliacao|exportar)$/);
      const args = [p.p_empresa,p.p_inicio,p.p_fim];
      if (nome.endsWith("extrato") || nome.endsWith("conciliacao")) args.push(p.p_pagina,p.p_tamanho);
      return Response.json(await rpc(token,nome,args));
    } catch (erro) {
      const status = {42501:403,22023:400}[erro.code];
      if (!status) throw erro;
      return new Response(null,{status});
    }
  });
  return (acao="resumo") => { falhar = acao; };
}

async function api(caminho, authorization, method="GET") {
  const url = new URL(caminho,"http://localhost");
  const rewrite = config.rewrites.find(r => r.source === url.pathname);
  assert.ok(rewrite);
  const query = Object.fromEntries(url.searchParams);
  Object.assign(query,Object.fromEntries(new URL(rewrite.destination,url).searchParams));
  const resposta = {
    headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},
    json(d){this.body=d;},end(){}
  };
  await handler({query,method,headers:{authorization}},resposta);
  assert.equal(resposta.headers["Cache-Control"],"no-store");
  return resposta;
}

test("API: rota Vercel, sessão, autorização e validação de datas/página",async t => {
  simular(t);
  const path = "/api/painel-financeiro?" + new URLSearchParams({empresa_id:a,acao:"extrato",inicio:dia,fim:dia});
  assert.equal((await api(path,"Bearer a")).body.transacoes.length,25);
  assert.equal((await api(path + "&pagina=2","Bearer a")).body.transacoes.length,1);
  assert.equal((await api(path + "&pagina=0","Bearer a")).code,400);
  assert.equal((await api(path.replace("fim="+dia,"fim=2026-11-31"),"Bearer a")).code,400);
  assert.equal((await api(path.replace("inicio="+dia,"inicio=2025-01-01"),"Bearer a")).code,400);
  assert.equal((await api(path,"Bearer b")).code,403);
  assert.equal((await api(path,"Bearer op")).code,403);
  assert.equal((await api(path,"Bearer inválido")).code,401);
  assert.equal((await api(path)).code,401);
  assert.equal((await api(path,"Bearer a","POST")).code,405);
  const conciliacao = path.replace("acao=extrato","acao=conciliacao");
  assert.equal((await api(conciliacao,"Bearer a")).body.pendentes.length,25);
  assert.equal((await api(conciliacao + "&pagina=2","Bearer a")).body.pendentes.length,1);
  assert.equal((await api(conciliacao.replace("inicio="+dia,"inicio=2025-11-20"),"Bearer a")).code,400);
  assert.equal((await api(conciliacao,"Bearer op")).code,403);
  assert.equal((await api(conciliacao,"Bearer b")).code,403);
  const exportar=path.replace("acao=extrato","acao=exportar");
  assert.equal((await api(exportar,"Bearer a")).body.transacoes.length,26);
  assert.equal((await api(exportar,"Bearer b")).code,403);
  assert.equal((await api(exportar)).code,401);
});

test("Chrome: área, filtros, provedor desconhecido, paginação, vazio, retry e mobile",{
  skip:!process.env.PAINEL_PLAYWRIGHT_MODULE || !process.env.PAINEL_CHROME_PATH
},async t => {
  const falhar = simular(t);
  const {chromium} = require(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({headless:true,executablePath:process.env.PAINEL_CHROME_PATH,
    args:["--disable-background-networking","--disable-component-update"]});
  const tipos = {".html":"text/html",".mjs":"text/javascript",".css":"text/css",".png":"image/png"};
  const servidor = createServer(async (req,res) => {
    try {
      const url = new URL(req.url,"http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const r = await api(req.url,req.headers.authorization);
        return res.writeHead(r.code,{"Content-Type":"application/json",...r.headers}).end(JSON.stringify(r.body));
      }
      const arquivo = resolve(root,"."+url.pathname);
      if (!arquivo.startsWith(root+sep)) return res.writeHead(403).end();
      const conteudo = await readFile(arquivo);
      res.writeHead(200,{"Content-Type":tipos[extname(arquivo)] ?? "application/octet-stream"}).end(conteudo);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });
  try {
    await new Promise(r => servidor.listen(0,"127.0.0.1",r));
    const pagina = await browser.newPage({viewport:{width:1366,height:950}});
    pagina.setDefaultTimeout(10000);
    const erros = [];
    pagina.on("pageerror",erro => erros.push(erro.message));
    await pagina.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async rota => {
      const {pathname} = new URL(rota.request().url());
      if (pathname === "/auth/v1/token") return rota.fulfill({json:{user:{id:usuarios.a},access_token:"a",refresh_token:"fixture",expires_in:3600}});
      if (pathname === "/rest/v1/membros") return rota.fulfill({json:[{empresas:{id:a,nome:"Loja A"}}]});
      return rota.abort();
    });
    await pagina.clock.setFixedTime(new Date("2026-11-20T15:00:00Z"));
    await pagina.goto("http://127.0.0.1:" + servidor.address().port + "/admin-loja.html");
    await pagina.getByLabel("E-mail",{exact:true}).fill("a@teste.invalid");
    await pagina.getByLabel("Senha",{exact:true}).fill("fixture");
    await pagina.getByRole("button",{name:"Entrar",exact:true}).click();
    await pagina.locator("#pagina").getByText("Página 1").waitFor();
    assert.equal(await pagina.locator("#lateral-painel nav button").count(),8);
    assert.equal(await pagina.locator("#aba-entregas + button").textContent(),"Financeiro");
    await pagina.locator("#aba-financeiro").click();
    const area = pagina.locator("#area-financeiro");
    const captura = async nome => {
      if (process.env.PAINEL_CAPTURAS) await pagina.screenshot({path:resolve(process.env.PAINEL_CAPTURAS,nome)});
    };
    const recebimentos = area.locator(":scope > [data-resultados]");
    const conciliacao = area.getByRole("region",{name:"Conciliação"});
    await recebimentos.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await recebimentos.locator("tbody tr").count(),25);
    await recebimentos.locator("[data-provedores]").getByText("provedor_b",{exact:true}).waitFor();
    await conciliacao.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await conciliacao.locator("tbody tr").count(),25);
    assert.equal(await conciliacao.getByText("Sem dados de webhook",{exact:true}).count(),2);
    await captura("financeiro-desktop.png");
    await recebimentos.getByRole("button",{name:"Próxima"}).click();
    await recebimentos.getByText("Página 2",{exact:true}).waitFor();
    assert.equal(await recebimentos.locator("tbody tr").count(),1);
    assert.equal(await recebimentos.getByRole("button",{name:"Próxima"}).isDisabled(),true);
    await conciliacao.getByRole("button",{name:"Próxima"}).click();
    await conciliacao.getByText("Página 2",{exact:true}).waitFor();
    assert.equal(await conciliacao.locator("tbody tr").count(),1);
    assert.equal(await conciliacao.getByRole("button",{name:"Próxima"}).isDisabled(),true);
    await area.getByRole("link",{name:"Ir para Conciliação"}).click();
    if (process.env.PAINEL_CAPTURAS) await conciliacao.screenshot({path:resolve(process.env.PAINEL_CAPTURAS,"conciliacao-desktop.png")});

    const filtro = area.getByLabel("Período");
    await filtro.selectOption("7");
    await recebimentos.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await area.locator("[data-grafico] li").count(),7);
    await filtro.selectOption("30");
    await recebimentos.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await area.locator("[data-grafico] li").count(),30);
    await filtro.selectOption("personalizado");
    await area.getByLabel("Início").fill("2026-11-01");
    await area.getByLabel("Fim").fill("2026-11-02");
    await area.getByRole("button",{name:"Aplicar"}).click();
    await area.getByText("Sem recebimentos no período",{exact:true}).waitFor();

    await conciliacao.getByText("Sem cobranças pendentes no período.").waitFor();
    falhar("conciliacao");
    await filtro.selectOption("7");
    await conciliacao.getByRole("button",{name:"Tentar novamente"}).click();
    await conciliacao.getByText("Página 1",{exact:true}).waitFor();
    falhar();
    await filtro.selectOption("hoje");
    await area.locator(":scope > [data-repetir]").click();
    await recebimentos.getByText("Página 1",{exact:true}).waitFor();
    await pagina.setViewportSize({width:390,height:844});
    await pagina.waitForFunction(() => document.querySelector("#lateral-painel").getBoundingClientRect().right <= 0);
    assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth),390);
    await captura("financeiro-mobile.png");
    await area.getByRole("heading",{name:"Extrato"}).scrollIntoViewIfNeeded();
    await captura("financeiro-mobile-extrato.png");
    await conciliacao.getByRole("heading",{name:"Conciliação",exact:true}).scrollIntoViewIfNeeded();
    await conciliacao.evaluate(sec => sec.scrollIntoView({block:"start"}));
    await captura("conciliacao-mobile.png");
    await conciliacao.getByRole("heading",{name:"Cobranças pendentes",exact:true}).evaluate(h => h.scrollIntoView({block:"center"}));
    await captura("conciliacao-pendentes-mobile.png");
    const estados=[["pendente","Pendente"],["confirmado","Confirmado"],["recusado","Recusado"],["cancelado","Cancelado"],
      ["estorno_parcial","Estorno parcial"],["estornado","Estornado"],["contestacao","Contestação"],["desconhecido","Desconhecido"]];
    for(const [i,[estado]] of estados.entries()){
      const n=14+i;
      await eventoPeriodo(n,estado,estado==="estornado"?String(n*100):estado==="estorno_parcial"?"300":null,
        "2026-11-21T01:05:00Z");
    }
    try {
      await filtro.selectOption("7");
      for (const [,label] of estados) await recebimentos.locator("tbody td:nth-child(9)").getByText(label,{exact:true}).waitFor();
      await pagina.getByText(/Valor estornado indisponível/).waitFor();
      await conciliacao.locator("[data-divergencias]").getByText(/^[1-9]\d*$/).waitFor();
      assert.ok(Number(await conciliacao.locator("[data-divergencias]").textContent())>0);
      assert.equal(await recebimentos.getByRole("columnheader",{name:"Taxa",exact:true}).count(),0);
      const download=pagina.waitForEvent("download");
      await area.getByRole("button",{name:"Exportar CSV"}).click();
      const arquivo=await download;
      assert.equal(arquivo.suggestedFilename(),"extrato-2026-11-14-2026-11-20.csv");
      if (process.env.PAINEL_CAPTURAS) await arquivo.saveAs(resolve(process.env.PAINEL_CAPTURAS,"extrato-fixture.csv"));
      const csv=await readFile(await arquivo.path(),"utf8");
      assert.ok(csv.includes('"estorno_parcial"')&&csv.includes('"contestacao"'));
      assert.equal(csv.split("\r\n").length,28);
      const rolagem=recebimentos.locator('[aria-label="Tabela de extrato"]');
      await rolagem.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
      await recebimentos.getByRole("columnheader",{name:"Estado PSP",exact:true}).scrollIntoViewIfNeeded();
      await captura("extrato-psp-mobile.png");
      await pagina.setViewportSize({width:1366,height:950});
      if (process.env.PAINEL_CAPTURAS) {
        await area.locator("[data-reversoes]").screenshot({path:resolve(process.env.PAINEL_CAPTURAS,"reversoes-periodo.png")});
      }
    } finally {
      await db.exec("delete from painel_privado.financeiro_eventos_psp where evento_id like 'reversao-%'");
    }

    assert.deepEqual(erros,[]);
  } finally {
    servidor.close();
    await browser.close();
  }
});
