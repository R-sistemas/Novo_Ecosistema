import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import webhook from "../api/asaas-quiosque-webhook.mjs";

test("webhooks Asaas usam tokens e caminhos distintos após rewrite", async t => {
  const env = {
    ASAAS_SANDBOX_WEBHOOK_TOKEN: "token-sandbox-fixture",
    ASAAS_QUIOSQUE_PRODUCTION_WEBHOOK_TOKEN: "token-producao-fixture",
    ASAAS_QUIOSQUE_PRODUCTION_API_KEY: "chave-asaas-fixture",
    SUPABASE_URL: "https://fixture.test",
    SUPABASE_SERVICE_ROLE_KEY: "chave-supabase-fixture"
  };
  const anterior = Object.fromEntries(Object.keys(env).map(nome => [nome, process.env[nome]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [nome, valor] of Object.entries(anterior)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });

  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const rota = config.rewrites.find(item => item.source === "/api/asaas-sandbox-webhook");
  const destino = new URL(rota.destination, "https://fixture.test");
  assert.equal(destino.pathname, "/api/asaas-quiosque-webhook");

  const sandbox = Object.fromEntries(destino.searchParams);
  const gravacoes = [];
  t.mock.method(globalThis, "fetch", async url => {
    gravacoes.push(new URL(url).pathname);
    return Response.json(true);
  });
  const body = { id: "evt_fixture", event: "PAYMENT_RECEIVED", payment: { id: "pay_fixture", value: 1 } };
  async function notificar(query, token) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, end() {} };
    await webhook({ method: "POST", query, headers: { "asaas-access-token": token }, body }, res);
    return res.code;
  }

  const teste = env.ASAAS_SANDBOX_WEBHOOK_TOKEN;
  const producao = env.ASAAS_QUIOSQUE_PRODUCTION_WEBHOOK_TOKEN;
  assert.equal(await notificar(sandbox, producao), 401);
  assert.equal(await notificar({}, teste), 401);
  assert.equal(await notificar({ asaas_ambiente: ["sandbox", "outro"] }, teste), 404);
  assert.deepEqual(gravacoes, []);
  assert.equal(await notificar(sandbox, teste), 200);
  assert.deepEqual(gravacoes, ["/rest/v1/rpc/registrar_evento_pix_sandbox"]);
  assert.equal(await notificar({}, producao), 200);
  assert.equal(gravacoes.length, 1);
});
