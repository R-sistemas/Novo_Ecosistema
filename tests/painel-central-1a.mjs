import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, test } from "node:test";
import sessao from "../central/api/central/sessao.mjs";
import empresas from "../central/api/central/empresas.mjs";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const id = n => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const admin = id(100);
const gestor = id(101);
const fator = id(102);
const alvo = id(1);
const a1 = { usuario: admin, aal: "aal1" };
const a2 = { usuario: admin, aal: "aal2" };
const loja = { usuario: gestor, aal: "aal2" };
const ler = caminho => readFile(new URL(caminho, import.meta.url), "utf8");

async function como(identidade, sql, parametros = [], papel = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec("set local role " + papel);
    await tx.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: identidade.usuario, aal: identidade.aal })]);
    return tx.query(sql, parametros);
  });
}

before(async () => {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select current_setting('request.jwt.claims', true)::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
  `);
  for (const nome of ["202611050001_base_pdv", "202611180047_painel_autorizacao",
    "202611180048_painel_auditoria", "202611210073_central_inventario_licenca", "202611210074_politica_suspensao_central"]) {
    if (nome.endsWith("047_painel_autorizacao")) await db.exec("alter table public.empresas add column cardapio_slug text unique");
    await db.exec(await ler("../supabase/migrations/" + nome + ".sql"));
  }
  await db.query("insert into auth.users values ($1), ($2)", [admin, gestor]);
  for (let numero = 1; numero <= 21; numero++) {
    const sufixo = String(numero).padStart(2, "0");
    await db.query("insert into empresas values ($1,$2,$3)", [id(numero), "Empresa " + sufixo, "loja-" + sufixo]);
  }
  await db.query("insert into membros values ($1,$2,'gestor')", [alvo, gestor]);
  await db.query("insert into painel_privado.vinculos_centrais values ($1,'central')", [admin]);
});

after(() => db.close());

const consulta = "select public.central_empresas($1,$2,$3) as dados";
const alteracao = "select public.central_editar_licenca($1,$2,$3,$4,$5,$6,$7,$8,$9) as dados";

test("SQL exige AAL2 e autorização vigente, preserva isolamento e grants", async () => {
  for (const identidade of [a1, loja, {}]) {
    await assert.rejects(como(identidade, consulta, ["", 1, 20]), { code: "42501" });
  }
  await assert.rejects(como(a2, consulta, ["", 1, 20], "anon"), { code: "42501" });
  await assert.rejects(como(a2, consulta, ["", 1, 20], "service_role"), { code: "42501" });
  await assert.rejects(como(a2, "select * from painel_privado.central_licencas"), { code: "42501" });
  assert.equal((await como(a2, "select id from public.empresas")).rows.length, 0);
  assert.deepEqual((await como(loja, "select id from public.empresas")).rows, [{ id: alvo }]);
  await assert.rejects(como(a2, "select painel_contexto_sessao($1)", [alvo]), { code: "42501" });
  await db.exec("delete from painel_privado.capacidades_por_papel where capacidade = 'central.sessao'");
  try {
    await assert.rejects(como(a2, consulta, ["", 1, 20]), { code: "42501" });
  } finally {
    await db.exec("insert into painel_privado.capacidades_por_papel values ('central','central.sessao')");
  }
});

test("SQL lista, pagina, busca, calcula atraso e audita edição idempotente", async () => {
  const listar = async (busca, pagina) => (await como(a2, consulta, [busca, pagina, 20])).rows[0].dados;
  const primeira = await listar("", 1);
  assert.equal(primeira.empresas.length, 20);
  assert.equal(primeira.tem_proxima, true);
  assert.deepEqual(primeira.empresas[0], {
    id: alvo, nome: "Empresa 01", cardapio_slug: "loja-01", estado: "sem_classificacao",
    plano: null, preco_centavos: null, vencimento: null, pagamento: "pendente", dias_em_atraso: null, revisao: 0, situacao: "em_dia", situacao_automatica: "em_dia", modo_suspensao: "automatico", revisao_suspensao: 0
  });
  assert.deepEqual((await listar("", 2)).empresas.map(e => e.id), [id(21)]);
  assert.deepEqual((await listar(" LOJA-02 ", 1)).empresas.map(e => e.id), [id(2)]);
  assert.deepEqual((await listar("empresa 03", 1)).empresas.map(e => e.id), [id(3)]);
  assert.equal((await listar("%", 1)).empresas.length, 0);
  const data = (await db.query("select ((now() at time zone 'America/Sao_Paulo')::date - 4)::text as data")).rows[0].data;
  const dados = [alvo, 0, "ativa", "pro", 12345, data, "pendente", "Revisão contratual", id(201)];
  await assert.rejects(como(loja, alteracao, dados), { code: "42501" });
  await assert.rejects(como(a1, alteracao, dados), { code: "42501" });
  const resultados = await Promise.all([como(a2, alteracao, dados), como(a2, alteracao, dados)]);
  assert.deepEqual(resultados[0].rows, resultados[1].rows);
  assert.equal((await listar("loja-01", 1)).empresas[0].dias_em_atraso, 4);
  await assert.rejects(como(a2, alteracao, [...dados.slice(0, -1), id(202)]), { code: "23505" });
  const pago = [alvo, 1, "ativa", "pro", 12345, data, "pago", "Pagamento registrado", id(202)];
  await como(a2, alteracao, pago);
  assert.equal((await listar("loja-01", 1)).empresas[0].dias_em_atraso, 0);
  const eventos = (await db.query("select * from painel_privado.auditoria order by ocorrido_em")).rows;
  assert.equal(eventos.length, 2);
  assert.equal(eventos[0].empresa_id, null);
  assert.equal(eventos[0].escopo, "plataforma");
  assert.equal(eventos[0].entidade_id, alvo);
  assert.equal(eventos[0].autor_id, admin);
  assert.equal(eventos[0].antes, null);
  assert.equal(eventos[1].antes.pagamento, "pendente");
  assert.equal(eventos[1].depois.pagamento, "pago");
});

test("Chrome passa pelo login, MFA, inventário, busca, paginação, edição e saída", async t => {
  if (!process.env.PLAYWRIGHT_MODULE) return t.skip("Configure PLAYWRIGHT_MODULE para executar Chrome.");
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const projeto = JSON.parse(await ler("../central/vercel.json"));
  await como(a2, alteracao,
    [id(3), 0, "ativa", "basico", 12990, "2026-11-15", "pendente", "Licença de teste", id(203)]);
  const tokens = { a1, a2, loja };
  process.env.SUPABASE_URL = "https://fixture.test";
  process.env.SUPABASE_ANON_KEY = "teste";
  t.mock.method(globalThis, "fetch", async (url, opcoes) => {
    assert.equal(url.hostname, "fixture.test");
    const chave = opcoes.headers.Authorization?.slice(7);
    const identidade = tokens[chave];
    const dados = JSON.parse(opcoes.body ?? "{}");
    if (url.pathname === "/auth/v1/token") {
      if (dados.email === "invalido@example.test") return Response.json({}, { status: 400 });
      return Response.json({ access_token: dados.email === "central@example.test" ? "a1" : "loja" });
    }
    if (!identidade) return Response.json({}, { status: 401 });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: identidade.usuario, factors: [{ id: fator, factor_type: "totp", status: "verified" }] });
    }
    if (url.pathname.endsWith("/challenge")) return Response.json({ id: id(300) });
    if (url.pathname.endsWith("/verify")) {
      return dados.code === "123456" ? Response.json({ access_token: "a2" }) : Response.json({}, { status: 422 });
    }
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    try {
      const rpc = url.pathname.split("/").pop();
      const sql = {
        painel_contexto_sessao: "select public.painel_contexto_sessao($1) as dados",
        central_empresas: consulta, central_editar_licenca: alteracao,
        central_empresas_atencao: "select public.central_empresas_atencao($1,$2,$3) as dados",
        central_alterar_suspensao: "select public.central_alterar_suspensao($1,$2,$3,$4,$5) as dados"
      }[rpc];
      assert.ok(sql);
      const resultado = await como(identidade, sql, Object.values(dados));
      return Response.json(resultado.rows[0].dados);
    } catch (e) {
      if (e.code === "42501") return Response.json({ code: e.code }, { status: 403 });
      throw e;
    }
  });

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      for (const { key, value } of projeto.headers[0].headers) res.setHeader(key, value);
      const handler = { "/api/central/sessao": sessao, "/api/central/empresas": empresas }[url.pathname];
      if (handler) {
        const partes = [];
        for await (const parte of req) partes.push(parte);
        req.body = partes.length ? JSON.parse(Buffer.concat(partes).toString()) : undefined;
        req.query = Object.fromEntries(url.searchParams);
        res.status = codigo => { res.statusCode = codigo; return res; };
        res.json = corpo => {
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify(corpo));
        };
        await handler(req, res);
        return;
      }
      const caminho = url.pathname === "/" ? "/index.html" : url.pathname;
      if (!/^\/[a-z][a-z0-9./-]+\.(?:html|mjs|css|png)$/.test(caminho) || caminho.includes("..")) {
        res.writeHead(404).end();
        return;
      }
      const mime = { html: "text/html", mjs: "application/javascript", css: "text/css", png: "image/png" };
      const arquivo = await readFile(new URL("../central/public" + caminho, import.meta.url));
      res.setHeader("Content-Type", mime[caminho.split(".").pop()]);
      res.end(arquivo);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => { servidor.once("error", reject); servidor.listen(0, "127.0.0.1", resolve); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const base = "http://127.0.0.1:" + servidor.address().port;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const erros = [];
    page.on("pageerror", erro => erros.push(erro.message));
    await page.goto(base);
    const anon = await page.request.get(base + "/api/central/empresas");
    assert.equal(anon.status(), 401);
    assert.match(anon.headers()["cache-control"], /no-store/);
    const mfaPendente = await page.request.get(base + "/api/central/empresas", { headers: { Authorization: "Bearer a1" } });
    assert.equal(mfaPendente.status(), 403);
    const rotaLoja = await page.request.get(base + "/api/central/empresas", { headers: { Authorization: "Bearer loja" } });
    assert.equal(rotaLoja.status(), 403);
    async function login(email) {
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha").fill("senha-fixture");
      await page.getByRole("button", { name: "Continuar" }).click();
    }
    const capturar = async nome => {
      for (const [tamanho, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        if (process.env.CENTRAL_EVIDENCIA) {
          await page.screenshot({ path: join(process.env.CENTRAL_EVIDENCIA, nome + "-" + tamanho + ".png"), fullPage: nome !== "inventario" });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    };
    assert.ok(await page.locator(".marca img").evaluate(img => img.complete && img.naturalWidth > 0));
    await capturar("login");
    await login("loja@example.test");
    await page.getByText("Acesso central negado.").waitFor();
    await login("invalido@example.test");
    await page.getByText("Não foi possível entrar. Confira seu e-mail e senha.").waitFor();
    await capturar("login-erro");
    await login("central@example.test");
    await page.getByRole("heading", { name: "Verificação em duas etapas" }).waitFor();
    await capturar("mfa");
    await page.getByLabel("Código de 6 dígitos").fill("000000");
    await page.getByRole("button", { name: "Verificar código" }).click();
    await page.getByText("Código inválido ou expirado. Tente novamente.").waitFor();
    await capturar("mfa-erro");
    let responder;
    let sinalizar;
    const interceptada = new Promise(resolve => { sinalizar = resolve; });
    await page.route("**/api/central/empresas?*", async route => {
      await new Promise(resolve => { responder = resolve; sinalizar(); });
      await route.fulfill({ status: 503, json: { erro: "Não foi possível carregar as empresas." } });
    }, { times: 1 });
    await page.getByLabel("Código de 6 dígitos").fill("123456");
    await page.getByRole("button", { name: "Verificar código" }).click();
    await page.getByText("Carregando inventário").waitFor();
    await interceptada;
    try { await capturar("carregando"); } finally { responder?.(); }
    await page.getByText("Não foi possível carregar as empresas.").waitFor();
    await capturar("inventario-erro");
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await page.getByRole("button", { name: "Abrir Empresa 01", exact: true }).waitFor();
    await page.getByRole("cell", { name: "Em débito", exact: true }).first().waitFor();
    await capturar("inventario");
    await page.getByRole("button", { name: "Próxima" }).click();
    await page.getByText("Página 2").waitFor();
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByRole("button", { name: "Abrir Empresa 21", exact: true }).click();
    await page.getByRole("button", { name: "Voltar ao inventário" }).click();
    assert.equal(await page.getByRole("button", { name: "Abrir Empresa 21", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByLabel("Buscar empresa").fill("loja-02");
    await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("button", { name: "Abrir Empresa 02", exact: true }).click();
    await page.getByRole("heading", { name: "Empresa 02" }).waitFor();
    await page.getByLabel("Plano").selectOption("basico");
    await page.getByLabel("Preço mensal (R$)").fill("149.90");
    await page.getByLabel("Motivo da alteração").fill("Conferência local");
    await capturar("empresa");
    await page.getByRole("button", { name: "Salvar licença" }).click();
    await page.getByRole("cell", { name: "Básico", exact: true }).waitFor();
    await capturar("inventario-filtrado");
    const abrirEmpresa = page.getByRole("button", { name: "Abrir Empresa 02", exact: true });
    await abrirEmpresa.click();
    await page.getByLabel("Motivo da decisão operacional").fill("Suspensão de homologação");
    await page.getByRole("button", { name: "Suspender", exact: true }).click();
    await page.getByRole("cell", { name: "Bloqueada total", exact: true }).waitFor();
    await page.getByLabel("Somente lojas que precisam de atenção").check();
    await abrirEmpresa.waitFor();
    await capturar("atencao");
    await abrirEmpresa.click();
    await page.getByText("Suspensa manualmente", { exact: true }).waitFor();
    await capturar("suspensao");
    await page.getByLabel("Motivo da decisão operacional").fill("Liberação de homologação");
    await page.getByRole("button", { name: "Liberar manualmente", exact: true }).click();
    await page.getByText("Nenhuma empresa encontrada.").waitFor();
    await page.getByLabel("Somente lojas que precisam de atenção").uncheck();
    await abrirEmpresa.waitFor();
    await page.getByLabel("Buscar empresa").fill("empresa inexistente");
    await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByText("Nenhuma empresa encontrada.").waitFor();
    await capturar("inventario-vazio");
    await page.getByRole("button", { name: "Limpar busca" }).click();
    await page.getByRole("button", { name: "Abrir Empresa 01", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.getByRole("button", { name: "Continuar" }).waitFor();
    assert.deepEqual(erros, []);
  } finally {
    await browser?.close();
    servidor.close();
  }
});
