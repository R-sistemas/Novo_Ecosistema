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
