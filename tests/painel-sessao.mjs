import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import handler from "../api/cadastrar-operador.mjs";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const gestores = {
  a: "00000000-0000-0000-0000-000000000001",
  b: "00000000-0000-0000-0000-000000000002",
  operador: "00000000-0000-0000-0000-000000000003",
  central: "00000000-0000-0000-0000-000000000004"
};
const lojaA = "00000000-0000-0000-0000-00000000000a";
const lojaB = "00000000-0000-0000-0000-00000000000b";
const ler = caminho => readFile(new URL(caminho, import.meta.url), "utf8");
const { rewrites } = JSON.parse(await ler("../vercel.json"));
const rotaSessao = rewrites.find(item => item.source === "/api/painel-sessao");
assert.ok(rotaSessao);
const destino = new URL(rotaSessao.destination, "https://painel.example");
assert.equal(destino.pathname, "/api/cadastrar-operador");

async function executarComo(papel, usuario, sql, parametros = []) {
  return db.transaction(async transacao => {
    await transacao.exec("set local role " + papel);
    await transacao.query("select set_config('request.jwt.claim.sub', $1, true)", [usuario ?? ""]);
    return transacao.query(sql, parametros);
  });
}

before(async () => {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  for (const arquivo of ["202611050001_base_pdv", "202611180047_painel_autorizacao", "202611180048_painel_auditoria"]) {
    await db.exec(await ler("../supabase/migrations/" + arquivo + ".sql"));
  }

  for (const usuario of Object.values(gestores)) await db.query("insert into auth.users values ($1)", [usuario]);
  await db.query("insert into empresas (id, nome) values ($1, 'A'), ($2, 'B')", [lojaA, lojaB]);
  await db.query(`insert into membros values
    ($1, $3, 'gestor'), ($2, $4, 'gestor'), ($1, $5, 'operador')`,
    [lojaA, lojaB, gestores.a, gestores.b, gestores.operador]);
  await db.query("insert into painel_privado.vinculos_centrais values ($1, 'central')", [gestores.central]);
});

after(() => db.close());

async function requisitar(t, token, consulta = "", metodo = "GET") {
  t.mock.method(globalThis, "fetch", async (url, opcoes) => {
    assert.equal(opcoes.headers.apikey, "anon-teste");
    assert.equal(opcoes.headers.Authorization, "Bearer " + token);
    const usuario = gestores[token];
    if (url.pathname === "/auth/v1/user") {
      assert.equal(opcoes.method, undefined);
      return usuario ? Response.json({ id: usuario }) : new Response(null, { status: 401 });
    }
    assert.equal(url.pathname, "/rest/v1/rpc/painel_contexto_sessao");
    assert.equal(opcoes.method, "POST");
    try {
      const { p_empresa_id } = JSON.parse(opcoes.body);
      const { rows } = await executarComo("authenticated", usuario,
        "select painel_contexto_sessao($1) as dados", [p_empresa_id]);
      return Response.json(rows[0].dados);
    } catch (erro) {
      if (erro.code !== "42501") throw erro;
      return new Response(null, { status: 403 });
    }
  });

  process.env.SUPABASE_URL = "https://banco.example";
  process.env.SUPABASE_ANON_KEY = "anon-teste";
  const query = Object.fromEntries(destino.searchParams);
  const empresas = new URLSearchParams(consulta).getAll("empresa_id");
  if (empresas.length) query.empresa_id = empresas.length === 1 ? empresas[0] : empresas;
  const resposta = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(codigo) { this.codigo = codigo; return this; }, json(dados) { this.dados = dados; }, end() {} };
  const headers = token ? { authorization: "Bearer " + token } : {};
  await handler({ method: metodo, headers, query }, resposta);
  assert.equal(resposta.headers["Cache-Control"], "no-store");
  return resposta;
}

test("gestores podem acessar a própria loja e recebem 403 com o UUID de outra", async t => {
  for (const [usuario, propria, outra] of [["a", lojaA, lojaB], ["b", lojaB, lojaA]]) {
    const resposta = await requisitar(t, usuario, "empresa_id=" + propria);
    assert.equal(resposta.codigo, 200);
    assert.deepEqual(resposta.dados, {
      escopo: "loja", usuario_id: gestores[usuario], empresa_id: propria,
      perfis: ["gestor"], capacidades: ["loja.sessao"]
    });
    assert.equal((await requisitar(t, usuario, "empresa_id=" + outra)).codigo, 403);
  }
});

test("nega sessão ausente/inválida, operador e escopos trocados", async t => {
  assert.equal((await requisitar(t, null)).codigo, 401);
  assert.equal((await requisitar(t, "expirado")).codigo, 401);
  assert.equal((await requisitar(t, "operador", "empresa_id=" + lojaA)).codigo, 403);
  assert.equal((await requisitar(t, "a")).codigo, 403);
  assert.equal((await requisitar(t, "central", "empresa_id=" + lojaA)).codigo, 403);
  assert.equal((await requisitar(t, "a", "empresa_id=")).codigo, 400);
  assert.equal((await requisitar(t, "a", "empresa_id=" + lojaA + "&empresa_id=" + lojaB)).codigo, 400);
  assert.equal((await requisitar(t, "a", "", "POST")).codigo, 405);
});

test("a central exige capacidade vigente em cada requisição", async t => {
  const permitida = await requisitar(t, "central");
  assert.equal(permitida.codigo, 200);
  assert.deepEqual(permitida.dados.capacidades, ["central.sessao"]);
  await db.exec("delete from painel_privado.capacidades_por_papel");
  assert.equal((await requisitar(t, "central")).codigo, 403);
  await db.exec("insert into painel_privado.capacidades_por_papel values ('central', 'central.sessao')");
  await db.exec("delete from painel_privado.vinculos_centrais");
  assert.equal((await requisitar(t, "central")).codigo, 403);
});

test("chamada SQL direta também nega acesso e a trilha só aceita inserções autorizadas", async () => {
  const rpc = "select public.painel_contexto_sessao($1)";
  await assert.rejects(executarComo("authenticated", gestores.a, rpc, [lojaB]), { code: "42501" });
  await assert.rejects(executarComo("authenticated", null, rpc, [lojaA]), { code: "42501" });
  for (const papel of ["anon", "service_role"]) {
    await assert.rejects(executarComo(papel, gestores.a, rpc, [lojaA]), { code: "42501" });
  }

  await db.query(`insert into painel_privado.auditoria
    (autor_id, escopo, empresa_id, acao, entidade, requisicao_id)
    values ($1, 'loja', $2, 'teste', 'sessao', gen_random_uuid())`, [gestores.a, lojaA]);
  for (const operacao of ["update painel_privado.auditoria set antes = '{}'",
    "delete from painel_privado.auditoria", "truncate painel_privado.auditoria"]) {
    await assert.rejects(db.exec(operacao), { code: "42501" });
  }
  for (const papel of ["anon", "authenticated", "service_role"]) {
    await assert.rejects(executarComo(papel, gestores.a, "select * from painel_privado.auditoria"), { code: "42501" });
    await assert.rejects(executarComo(papel, gestores.a, "insert into painel_privado.auditoria default values"), { code: "42501" });
  }
  await db.query("delete from membros where empresa_id = $1 and usuario_id = $2", [lojaA, gestores.a]);
  await assert.rejects(executarComo("authenticated", gestores.a, rpc, [lojaA]), { code: "42501" });
});
