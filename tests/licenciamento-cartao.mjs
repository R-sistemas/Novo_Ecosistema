import assert from "node:assert/strict";
import {test} from "node:test";
import api from "../api/mercado-pago-empresa.mjs";

const uuid = n => "00000000-0000-0000-0000-" + String(n).padStart(12,"0");
const empresa=uuid(1), oferta=uuid(2), gestor=uuid(3), cobranca=uuid(4), requisicao=uuid(5);
const cartao = {token:"token-sintetico-sem-cartao",bin:"999999",oferta,termos:"termos-v2",requisicao};
const condicoes = {base:60000,total:68592,parcela:11432,vezes:6,bandeira:"master"};

test("checkout só processa ORDTST com cotação confirmada e guarda a mesma ordem",async t => {
  const config = {
    SUPABASE_URL:"https://local.example.invalid",SUPABASE_ANON_KEY:"chave-simulada",SUPABASE_SERVICE_ROLE_KEY:"servico-simulado",
    LICENCAS_MP_SANDBOX_TOKEN:"TEST-fixture",LICENCAS_MP_SANDBOX_RECEBEDOR:"1234",
    LICENCAS_MP_SANDBOX_PUBLIC_KEY:"TEST-publica",LICENCAS_MP_SANDBOX_PAYER:"test_payer@example.com"
  };
  const anteriores = Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));
  Object.assign(process.env,config);
  const anterior = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = anterior;
    for (const [k,v] of Object.entries(anteriores)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const efeitos = [];
  let recurso = "ORDTSTVAL001", vinculada, status = "created", versaoPagamento;
  const ordem = () => ({id:recurso,collector_id:1234,external_reference:cobranca,processing_mode:"manual",
    total_amount:"600.00",status,status_detail:status==="processed"?"accredited":status,created_date:"2026-11-27T00:00:00Z",
    transactions:{payments:versaoPagamento?[versaoPagamento]:[]}});
  const rpc = {
    "/auth/v1/user": () => ({id:gestor}),
    "/rest/v1/rpc/loja_licenca_resumo": () => ({cobranca_ativa:true,ofertas:[
      {id:oferta,meses:6,termos_versao:"termos-v2",preco_centavos:60000}]}),
    "/rest/v1/rpc/servico_licenca_reservar_cartao": dados => {
      assert.deepEqual(dados.p_condicoes,condicoes);
      return {id:cobranca,estado:"pendente",valor_centavos:60000,condicoes,recurso:vinculada};
    },
    "/rest/v1/rpc/servico_licenca_observar_ordem": dados => {
      vinculada = dados.p_recurso;
      return dados.p_tipo==="pago" ? "confirmado" : "pendente";
    }
  };
  globalThis.fetch = async (url,opts) => {
    const {hostname,pathname} = new URL(url);
    const dados = opts.body ? JSON.parse(opts.body) : {};
    if (hostname==="local.example.invalid") return Response.json(rpc[pathname](dados));
    assert.equal(hostname,"api.mercadopago.com");
    if (pathname==="/users/me") return Response.json({id:1234,country_id:"BR",tags:["test_user"]});
    if (pathname==="/v1/payment_methods/installments") return Response.json([{payment_method_id:"master",payer_costs:[
      {installments:1,installment_amount:600,total_amount:600},
      {installments:2,installment_amount:300,total_amount:600,installment_rate:0},
      {installments:6,installment_amount:114.32,total_amount:685.92,installment_rate:14.32},
      {installments:7,installment_amount:100,total_amount:700,installment_rate:16}
    ]}]);
    if (pathname==="/v1/orders") { efeitos.push("reservar"); return Response.json(ordem()); }
    if (pathname.endsWith("/transactions")) {
      efeitos.push("adicionar");
      assert.equal(dados.payments[0].amount,"600.00");
      versaoPagamento = {status:"created",amount:"600.00",payment_method:{id:"master",type:"credit_card",
        installments:6,installment_amount:"114.32"}};
      return Response.json({payments:[versaoPagamento]});
    }
    if (pathname.endsWith("/process")) {
      efeitos.push("processar");
      status = "processed";
      versaoPagamento.status = "processed";
      versaoPagamento.paid_amount = "685.92";
      return Response.json(ordem());
    }
    if (pathname===`/v1/orders/${recurso}`) return Response.json(ordem());
    assert.fail("rota inesperada " + pathname);
  };
  async function executar(acao,dados) {
    const res = {codigo:0,corpo:null,status(n){this.codigo=n;return this;},json(o){this.corpo=o;},end(){},setHeader(){}};
    await api({method:"POST",headers:{authorization:"Bearer jwt-teste"},query:{operacao_mp:"licenca_cartao"},
      body:{acao,empresa,...dados}},res);
    return res;
  }
  const cotacao = await executar("cotar",cartao);
  assert.equal(cotacao.codigo,200);
  assert.deepEqual(cotacao.corpo.opcoes.map(x=>x.vezes),[1,6]);
  const divergente = await executar("pagar",{...cartao,condicoes:{...condicoes,total:60000}});
  assert.equal(divergente.codigo,409);
  assert.deepEqual(efeitos,[]);
  recurso = "ORDPROD001";
  assert.equal((await executar("pagar",{...cartao,condicoes})).codigo,503);
  assert.deepEqual(efeitos,["reservar"]);
  efeitos.length = 0;
  recurso = "ORDTSTVAL001";
  assert.equal((await executar("pagar",{...cartao,condicoes})).corpo.estado,"confirmado");
  assert.equal((await executar("pagar",{...cartao,condicoes})).corpo.estado,"confirmado");
  assert.deepEqual(efeitos,["reservar","adicionar","processar"]);
});
