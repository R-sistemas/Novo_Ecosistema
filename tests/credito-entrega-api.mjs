import assert from "node:assert/strict";
import { test } from "node:test";
import sandbox from "../api/checkout-credito-mercado-pago-teste.mjs";
import producao from "../api/checkout-credito-mercado-pago-quiosque.mjs";
import { cifrarCredencialMP } from "../lib/cofre-mercado-pago.mjs";

const empresa = "10000000-0000-0000-0000-000000000001";
const integracao = "10000000-0000-0000-0000-000000000002";
const pedido = "10000000-0000-0000-0000-000000000003";
const resposta = () => ({
  setHeader() {}, status(code) { this.codigo = code; return this; },
  json(dados) { this.dados = dados; }
});

for (const [ambiente, handler] of [["sandbox", sandbox], ["producao", producao]]) {
  test("entrega com cartão em " + ambiente + " valida contato, frete e versão da configuração", async t => {
    const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture",
      REMO_API_URL: "https://remo.example.invalid", REMO_API_KEY: "fixture",
      MP_PEDIDOS_COFRE_V1: Buffer.alloc(32, 7).toString("base64url") };
    const anterior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    t.after(() => Object.entries(anterior).forEach(([k,v]) => {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }));
    const tecnico = { empresa, integracao, ambiente, recebedor: ambiente === "sandbox" ? "3095871690" : "12345" };
    const envelope = cifrarCredencialMP({ access_token: "token-"+ambiente, webhook_secret:"fixture" }, tecnico);
    const ordem = ambiente === "sandbox" ? "ORDTST1" : "ORD1";
    const chamadas = [];
    t.mock.method(globalThis, "fetch", async (url, opts) => {
      const { pathname } = new URL(url);
      chamadas.push(pathname);
      const dados = JSON.parse(opts.body ?? "{}");
      if (pathname === "/rest/v1/empresas") return Response.json([{ id:empresa, oferece_entrega:ambiente==="producao", sandbox_checkout:ambiente==="sandbox" }]);
      if (pathname.endsWith("/preview")) return Response.json({ ok: true, fee: 5 });
      if (pathname.endsWith("/servico_mp_reserva_credito")) {
        assert.equal(dados.p_ambiente, ambiente);
        assert.equal(dados.p_frete, 500);
        assert.equal(dados.p_endereco.telefone, "62999999999");
        if (dados.p_chave_publica !== "chave-"+ambiente) return Response.json({code:"PT409"}, {status:409});
        return Response.json({...tecnico, envelope, total_centavos:1500});
      }
      if (pathname === "/v1/orders") {
        assert.equal(opts.headers.Authorization, "Bearer token-"+ambiente);
        return Response.json({ id:ordem, external_reference:pedido, collector_id:tecnico.recebedor,
          total_amount:"15.00", status:"processed", transactions:{payments:[{payment_method:{type:"credit_card"}}]} });
      }
      if (pathname.endsWith("/servico_mp_vincular_ordem")) {
        assert.equal(dados.p_integracao, integracao);
        return Response.json(true);
      }
      assert.fail("Rota inesperada " + pathname);
    });
    const corpo = {
      p_id:pedido,p_slug:"loja-fixture",p_cliente:"Cliente",p_itens:[{produto_id:empresa,quantidade:1}],
      pagamento:"online",frete_centavos:500,chave_publica:"chave-"+ambiente,
      cartao:{token:"cartao-fixture",email:"cliente@example.invalid",bandeira:"visa"},
      endereco:{latitude:-16.68,longitude:-49.26,maps_url:"https://www.google.com/maps?q=-16.680000,-49.260000",
        telefone:"62999999999",metodo_pagamento:"credito"}
    };
    async function chamar(alteracoes) {
      const res = resposta();
      await handler({ method:"POST",body:{...corpo,...alteracoes} },res);
      return res;
    }
    assert.equal((await chamar({ endereco:{...corpo.endereco, telefone:""} })).codigo,400);
    assert.equal(chamadas.length,0);
    const atualizado = await chamar({ frete_centavos:400 });
    assert.equal(atualizado.codigo,409);
    assert.equal(atualizado.dados.frete_centavos,500);
    assert.ok(chamadas.at(-1).endsWith("/preview"));
    const desatualizado = await chamar({ chave_publica:"chave-antiga" });
    assert.equal(desatualizado.codigo,409);
    assert.equal(desatualizado.dados.codigo,"configuracao_cartao_alterada");
    assert.ok(!chamadas.includes("/v1/orders"));
    assert.equal((await chamar({})).codigo,200);
    assert.equal(chamadas.filter(p => p === "/v1/orders").length,1);
  });
}
