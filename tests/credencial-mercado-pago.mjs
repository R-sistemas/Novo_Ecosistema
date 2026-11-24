import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import credencialMP from "../api/credencial-mercado-pago.mjs";

test("API recusa token reprovado sem persistir ou devolver segredo", async t => {
  const anteriorUrl = process.env.SUPABASE_URL;
  const anteriorAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://supabase.example.test";
  process.env.SUPABASE_ANON_KEY = "fixture";
  t.after(() => {
    if (anteriorUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = anteriorUrl;
    if (anteriorAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = anteriorAnon;
  });
  const requisicoes = [];
  t.mock.method(globalThis, "fetch", async url => {
    const rota = new URL(url).pathname;
    requisicoes.push(rota);
    if (rota === "/rest/v1/rpc/loja_status_credencial_mp") return Response.json({ revisao: 0 });
    if (rota === "/auth/v1/user") return Response.json({ id: "00000000-0000-0000-0000-000000000002" });
    if (rota === "/users/me") return Response.json({ error: "invalid_token" }, { status: 401 });
    assert.fail("Não deve persistir uma credencial inválida.");
  });
  const resposta = { setHeader() {}, status(code) { this.codigo = code; return this; }, json(dados) { this.dados = dados; } };
  await credencialMP({ method: "POST", headers: { authorization: "Bearer fixture" },
    query: { empresa: "00000000-0000-0000-0000-000000000001", ambiente: "producao" },
    body: { access_token: "APP_USR-token-fixture", webhook_secret: "segredo-fixture",
      chave_publica: "APP_USR-chave-fixture", revisao: 0 } }, resposta);
  assert.equal(resposta.codigo, 422);
  assert.deepEqual(resposta.dados, { erro: "O Mercado Pago recusou o Access Token." });
  assert.deepEqual(requisicoes, ["/rest/v1/rpc/loja_status_credencial_mp", "/auth/v1/user", "/users/me"]);
});

test("checkouts selecionam por reserva e webhook autentica a aplicação", async t => {
  const { checkout } = await import("../api/checkout-pix-mercado-pago-teste.mjs");
  const { checkoutCredito } = await import("../api/checkout-credito-mercado-pago-teste.mjs");
  const { default: webhook } = await import("../api/mercado-pago-empresa-webhook.mjs");
  const { cifrarCredencialMP } = await import("../lib/cofre-mercado-pago.mjs");
  const env = { SUPABASE_URL: "https://supabase.example.test", SUPABASE_SERVICE_ROLE_KEY: "servico-fixture",
    MP_PEDIDOS_COFRE_V1: Buffer.alloc(32, 7).toString("base64url") };
  const anterior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => Object.entries(anterior).forEach(([k,v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));
  const id = n => "00000000-0000-0000-0000-" + String(n).padStart(12,"0");
  const empresas = ["a","b"].map((slug,i) => {
    const conta = { empresa:id(i+1), ambiente:"producao", recebedor:String(100+i), integracao:id(i+10) };
    return { slug, conta, pedido:id(i+20), token:"token-"+slug, segredo:"segredo-"+slug, ordem:"ORD"+(i+1) };
  });
  for (const e of empresas) e.conta.envelope = cifrarCredencialMP({ access_token:e.token, webhook_secret:e.segredo },e.conta);
  const chamadas = [];
  t.mock.method(globalThis,"fetch",async (url, opcoes) => {
    const rota = new URL(url).pathname;
    const corpo = JSON.parse(opcoes?.body ?? "{}");
    if (rota.endsWith("/servico_mp_reserva_pedido")) {
      const e = empresas.find(x => x.slug === corpo.p_slug && x.pedido === corpo.p_id);
      return Response.json(e ? { ...e.conta,total_centavos:100,cobranca:null } : null);
    }
    if (rota.endsWith("/servico_integracao_mp_webhook")) {
      return Response.json(empresas.find(e => e.conta.integracao === corpo.p_integracao)?.conta ?? null);
    }
    if (rota.endsWith("/servico_mp_vincular_ordem") || rota.endsWith("/servico_mp_evento_financeiro") ||
        rota.endsWith("/servico_mp_registrar_webhook_pendente")) {
      chamadas.push(corpo);
      return Response.json(true);
    }
    if (rota.startsWith("/v1/orders")) {
      const pedido = corpo.external_reference;
      const e = empresas.find(x => pedido ? x.pedido === pedido : rota.endsWith("/"+x.ordem));
      assert.ok(e);
      assert.equal(opcoes.headers.Authorization,"Bearer "+e.token);
      const credito = e.slug === "b";
      return Response.json({ id:e.ordem, external_reference:e.pedido, collector_id:e.conta.recebedor, total_amount:"1.00",
        status:credito ? "processed" : "action_required", status_detail:credito ? "accredited" : "waiting_transfer",
        transactions:{payments:[{status:credito ? "processed" : "action_required",amount:"1.00",
          payment_method:credito ? {type:"credit_card"} : {type:"bank_transfer",id:"pix",qr_code_base64:"png",qr_code:"pix"}}]} });
    }
    assert.fail("Rota inesperada: "+rota);
  });
  const resposta = () => ({ setHeader() {}, status(code) { this.codigo=code; return this; },
    json(dados) { this.dados=dados; return this; }, end() { return this; } });
  for (const e of empresas) {
    const res = resposta();
    const req = { method:"POST", headers:{},body:{p_slug:e.slug,p_id:e.pedido,p_cliente:"Fixture",
      p_itens:[{produto_id:id(99),quantidade:1}],cartao:{token:"fixture-cartao",bandeira:"visa",email:"fixture@example.test"}} };
    await (e.slug === "a" ? checkout : checkoutCredito)(req,res,{ sandbox:false,porEmpresa:true });
    assert.equal(res.codigo,200);
    assert.equal(chamadas.at(-1).p_integracao,e.conta.integracao);
  }
  const e=empresas[1], timestamp="1795400000", requestId="webhook-fixture";
  const assinar = segredo => "ts="+timestamp+",v1="+createHmac("sha256",segredo)
    .update("id:"+e.ordem.toLowerCase()+";request-id:"+requestId+";ts:"+timestamp+";").digest("hex");
  const req = { method:"POST",query:{integracao:e.conta.integracao,"data.id":e.ordem},
    headers:{"x-request-id":requestId,"x-signature":assinar(empresas[0].segredo)} };
  e.conta.estado = "pendente";
  const negada = resposta();
  const antes = chamadas.length;
  await webhook(req,negada);
  assert.equal(negada.codigo,401);
  assert.equal(chamadas.length,antes);
  req.headers["x-signature"] = assinar(e.segredo);
  const pendente = resposta();
  await webhook(req,pendente);
  assert.equal(pendente.codigo,200);
  assert.deepEqual(chamadas.slice(antes),[{p_integracao:e.conta.integracao,p_tipo:"ordem",p_recurso:e.ordem}]);
  e.conta.estado = "ativa";
  const aceita=resposta();
  await webhook(req,aceita);
  assert.equal(aceita.codigo,200);
  assert.equal(chamadas[antes+1].p_integracao,e.conta.integracao);
  assert.equal(chamadas[antes+1].p_confirmado,true);
});

test("Pix sandbox devolve copia-e-cola sem imagem e permite retomar", async t => {
  const { checkout } = await import("../api/checkout-pix-mercado-pago-teste.mjs");
  const urlAnterior=process.env.SUPABASE_URL;
  process.env.SUPABASE_URL="https://fixture.test";
  t.after(() => { if(urlAnterior === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL=urlAnterior; });
  const pedido="00000000-0000-0000-0000-000000000001";
  let cobranca;
  t.mock.method(globalThis,"fetch",async (url,opts) => {
    const path=new URL(url).pathname;
    if(path.endsWith("servico_mp_reserva_pedido"))
      return Response.json({legado:true,pedido:{total_centavos:100,cobranca}});
    if(path.endsWith("atualizar_pix_mercado_pago_teste")) {
      cobranca=JSON.parse(opts.body).p_cobranca;
      return Response.json(true);
    }
    assert.match(path,/^\/v1\/orders(?:\/ORDTST1)?$/);
    if (!cobranca) assert.equal(JSON.parse(opts.body).payer.first_name,"APRO");
    return Response.json({id:"ORDTST1",external_reference:pedido,total_amount:"1.00",status:"action_required",
      transactions:{payments:[{payment_method:{id:"pix",qr_code:"fixture-pix",qr_code_base64:""}}]}});
  });
  for (let i=0;i<2;i++) {
    const res={setHeader(){},status(s){this.statusCode=s;return this;},json(body){this.body=body;return this;}};
    await checkout({method:"POST",body:{p_slug:"loja-teste",p_id:pedido,p_itens:[{}]}},res,
      {sandbox:true,token:"fixture",porEmpresa:true});
    assert.equal(res.statusCode,200);
    assert.deepEqual(res.body,{imagem:null,copiaECola:"fixture-pix",sandbox:true});
  }
});
