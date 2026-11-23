import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, test } from "node:test";
import sessao from "../central/api/central/sessao.mjs";
import onboarding from "../central/api/central/onboarding.mjs";
import ativar from "../central/api/central/ativar-gestor.mjs";
import { cifrarCredencialMP, decifrarCredencialMP } from "../lib/cofre-mercado-pago.mjs";
import auditoria from "../central/api/central/auditoria.mjs";
import licencas from "../central/api/central/licencas.mjs";
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
    create table auth.users (id uuid primary key, email text unique, invited_at timestamptz, raw_user_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$
      select current_setting('request.jwt.claims', true)::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
  `);
  for (const nome of ["202611050001_base_pdv", "202611180047_painel_autorizacao",
    "202611180048_painel_auditoria", "202611210073_central_inventario_licenca", "202611210074_politica_suspensao_central", "202611210076_central_pagamentos_licenca", "202611210077_central_historico_empresa", "202611210078_central_filtros_empresas", "202611210079_central_onboarding", "202611210080_central_auditoria_global", "202611210081_credenciais_mercado_pago_empresa"]) {
    if (nome.endsWith("047_painel_autorizacao")) await db.exec("alter table public.empresas add column cardapio_slug text unique");
    if (nome.startsWith("202611210080")) await db.exec("alter table painel_privado.auditoria add column origem_autor text not null default 'usuario'");
    await db.exec(await ler("../supabase/migrations/" + nome + ".sql"));
  }
  await db.query("insert into auth.users (id,email) values ($1,'central@example.test'), ($2,'loja@example.test')", [admin, gestor]);
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
  const { data, atraso } = (await db.query("select '2020-01-05' as data, (now() at time zone 'America/Sao_Paulo')::date - date '2020-01-05' as atraso")).rows[0];
  const dados = [alvo, 0, "ativa", "pro", 12345, data, "pendente", "Revisão contratual", id(201)];
  await assert.rejects(como(loja, alteracao, dados), { code: "42501" });
  await assert.rejects(como(a1, alteracao, dados), { code: "42501" });
  const invalido = [...dados];
  invalido[5] = "2020-01-06";
  await assert.rejects(como(a2, alteracao, invalido), { code: "22023" });
  const resultados = await Promise.all([como(a2, alteracao, dados), como(a2, alteracao, dados)]);
  assert.deepEqual(resultados[0].rows, resultados[1].rows);
  assert.equal((await listar("loja-01", 1)).empresas[0].dias_em_atraso, atraso);
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
    [id(3), 0, "ativa", "basico", 12990, "2020-11-05", "pendente", "Licença de teste", id(203)]);
  const tokens = { a1, a2, loja, convidado: { usuario: id(2300), aal: "aal1" } };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
  process.env.CENTRAL_GESTOR_REDIRECT = "https://central.example.test/ativar-gestor.html";
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
    if (chave === "fixture-service") {
      if (url.pathname.endsWith("/central_dados_convite")) {
        const r = await como({}, "select public.central_dados_convite($1) as dados", [dados.p_empresa], "service_role");
        return Response.json(r.rows[0].dados);
      }
      assert.equal(url.pathname, "/auth/v1/invite");
      assert.equal(url.searchParams.get("redirect_to"), process.env.CENTRAL_GESTOR_REDIRECT);
      await db.query("insert into auth.users values ($1,$2,null,$3)", [id(2300), dados.email, dados.data]);
      await db.query("update auth.users set invited_at=now() where id=$1", [id(2300)]);
      return Response.json({ id: id(2300) });
    }
    if (!identidade) return Response.json({}, { status: 401 });
    if (url.pathname === "/auth/v1/user" && opcoes.method === "PUT") {
      assert.equal(chave, "convidado");
      assert.equal(dados.password, "senha-apenas-fixture");
      return Response.json({});
    }
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
        central_auditoria_global: "select public.central_auditoria_global($1,$2,$3,$4,$5,$6,$7) as dados",
        central_gestor_convidado: "select public.central_gestor_convidado() as dados",
        central_criar_empresa: "select public.central_criar_empresa($1,$2,$3,$4,$5,$6,$7,$8) as dados",
        central_empresas: consulta, central_editar_licenca: alteracao,
        central_empresas_filtradas: "select public.central_empresas_filtradas($1,$2,$3,$4) as dados",
        central_historico_empresa: "select public.central_historico_empresa($1,$2) as dados",
        central_registrar_pagamento: "select public.central_registrar_pagamento($1,$2,$3,$4,$5,$6) as dados",
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
      const handler = { "/api/central/sessao": sessao, "/api/central/empresas": empresas, "/api/central/licencas": licencas, "/api/central/onboarding": onboarding, "/api/central/ativar-gestor": ativar, "/api/central/auditoria": auditoria }[url.pathname];
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
      await page.locator("#login").getByLabel("E-mail").fill(email);
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
    await page.getByRole("button", { name: "Nova empresa" }).click();
    await page.getByRole("dialog", { name: "Nova empresa" }).waitFor();
    await capturar("onboarding");
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    await page.locator("#busca select[name=situacao]").selectOption("sem_licenca");
    await page.getByRole("button", { name: "Abrir Empresa 02", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Abrir Empresa 03", exact: true }).count(), 0);
    await page.locator("#busca select[name=situacao]").selectOption("");
    await page.getByRole("button", { name: "Abrir Empresa 03", exact: true }).click();
    await page.locator("#historico-licenca").getByText("Licença de teste", { exact: false }).waitFor();
    await capturar("quitacao-historico");
    await page.locator("#quitar-ciclo input[name=data]").fill("2020-01-05");
    await page.locator("#quitar-ciclo input[type=checkbox]").check();
    await page.getByRole("button", { name: "Quitar ciclo" }).click();
    await page.getByRole("button", { name: "Abrir Empresa 03", exact: true }).waitFor();
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
    await page.locator("#licenca").getByLabel("Plano").selectOption("basico");
    await page.locator("#licenca").getByLabel("Preço mensal (R$)").fill("149.90");
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
    await page.getByRole("button", { name: "Nova empresa" }).click();
    const formNova = page.getByRole("dialog");
    await formNova.getByLabel("Nome", { exact: true }).fill("TESTE-CHROME");
    await formNova.getByLabel("Slug do cardápio").fill("teste-chrome");
    await formNova.getByLabel("E-mail do gestor").fill("chrome@example.test");
    await formNova.getByLabel("Preço mensal").fill("120");
    await formNova.getByLabel("Primeiro vencimento").fill("2030-01-05");
    await formNova.getByRole("button", { name: "Criar e convidar gestor" }).click();
    await formNova.waitFor({ state: "hidden" });
    const convidado = await browser.newPage();
    await convidado.goto(base + "/ativar-gestor.html#type=invite&access_token=convidado");
    await convidado.getByLabel("Crie sua senha").fill("senha-apenas-fixture");
    await convidado.getByLabel("Repita a senha").fill("senha-apenas-fixture");
    await convidado.getByRole("button", { name: "Definir senha" }).click();
    await convidado.getByRole("link", { name: "Abrir painel da loja" }).waitFor();
    await convidado.close();
    assert.equal((await page.request.get(base + "/api/central/auditoria")).status(), 401);
    assert.equal((await page.request.get(base + "/api/central/auditoria", { headers: { Authorization: "Bearer loja" } })).status(), 403);
    await page.getByRole("button", { name: "Auditoria" }).click();
    await page.locator("#eventos-auditoria tr").first().waitFor();
    await page.locator("#filtros-auditoria input[name=empresa]").fill("TESTE-CHROME");
    await page.getByRole("button", { name: "Filtrar", exact: true }).click();
    await page.getByRole("cell", { name: "TESTE-CHROME", exact: true }).first().waitFor();
    await page.locator("#eventos-auditoria summary").last().click();
    await page.locator("#eventos-auditoria").getByText("Básico", { exact: true }).waitFor();
    await capturar("auditoria-global");
    await page.getByRole("button", { name: "Inventário", exact: true }).click();
    await page.getByRole("heading", { name: "Inventário", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.getByRole("button", { name: "Continuar" }).waitFor();
    assert.deepEqual(erros, []);
  } finally {
    await browser?.close();
    servidor.close();
  }
});

test("SQL quita um ciclo pelo vencimento esperado e não avança novamente no retry", async () => {
  const empresa = id(19);
  const ciclo = "2030-01-05";
  await como(a2, alteracao, [empresa, 0, "ativa", "pro", 12500, ciclo, "pendente", "Contrato", id(1900)]);
  const sql = "select public.central_registrar_pagamento($1,$2,$3,$4,$5,$6) as dados";
  const args = [empresa, 1, ciclo, "2020-12-20", 12500, id(1901)];
  for (const identidade of [a1, loja]) await assert.rejects(como(identidade, sql, args), { code: "42501" });
  const resultado = (await como(a2, sql, args)).rows[0].dados;
  assert.equal(resultado.vencimento, "2030-02-05");
  assert.equal(resultado.revisao, 2);
  assert.equal(resultado.pagamento, "pendente");
  assert.equal(resultado.vencimento_quitado, ciclo);
  assert.deepEqual((await como(a2, sql, args)).rows[0].dados, resultado);
  await assert.rejects(como(a2, sql, [...args.slice(0, -1), id(1902)]), { code: "23505" });
  const historico = "select public.central_historico_empresa($1,1) as dados";
  await assert.rejects(como(loja, historico, [empresa]), { code: "42501" });
  const eventos = (await como(a2, historico, [empresa])).rows[0].dados.eventos;
  assert.deepEqual(eventos.map(evento => evento.acao), ["central.registrar_pagamento", "central.editar_licenca"]);
  const auditoria = await db.query("select autor_id, entidade_id, empresa_id from painel_privado.auditoria where requisicao_id = $1", [id(1901)]);
  assert.deepEqual(auditoria.rows, [{ autor_id: admin, entidade_id: empresa, empresa_id: null }]);
});

test("SQL cria empresa e licença, vincula apenas o gestor convidado e preserva isolamento", async () => {
  const sql = "select public.central_criar_empresa($1,$2,$3,$4,$5,$6,$7,$8) as empresa";
  const args = ["TESTE-NOVA", "teste-nova", "gestor@example.test", "basico", 12000, "2020-01-05", "pendente", id(2200)];
  await assert.rejects(como(a1, sql, args), { code: "42501" });
  await assert.rejects(como(loja, sql, args), { code: "42501" });
  const empresa = (await como(a2, sql, args)).rows[0].empresa;
  assert.equal((await como(a2, sql, args)).rows[0].empresa, empresa);
  await assert.rejects(como(a2, "select public.central_dados_convite($1)", [empresa]), { code: "42501" });
  const convite = "select public.central_dados_convite($1) as dados";
  assert.equal((await como(a2, sql, [...args.slice(0, -1), id(2203)])).rows[0].empresa, empresa);
  const pendente = (await como({}, convite, [empresa], "service_role")).rows[0].dados;
  assert.equal(pendente.vinculado, false);
  assert.equal((await como(loja, "select id from public.empresas where id=$1", [empresa])).rows.length, 0);
  await db.query("insert into auth.users values ($1,$2,null,$3)", [id(2201), "outro@example.test", { rs_convite: pendente.chave }]);
  assert.equal((await como({}, convite, [empresa], "service_role")).rows[0].dados.vinculado, false);
  await db.query("insert into auth.users values ($1,$2,null,$3)", [id(2202), pendente.email, { rs_convite: pendente.chave }]);
  await db.query("update auth.users set invited_at=now() where id in ($1,$2)", [id(2201), id(2202)]);
  const contexto = await como({ usuario: id(2202), aal: "aal1" }, "select public.painel_contexto_sessao($1) as dados", [empresa]);
  assert.equal(contexto.rows[0].dados.escopo, "loja");
  const filtrados = await como(a2, "select public.central_empresas_filtradas('TESTE-NOVA',1,20,'bloqueada') as dados");
  assert.equal(filtrados.rows[0].dados.empresas[0].id, empresa);
  const eventos = await db.query("select acao from painel_privado.auditoria where entidade_id = $1 order by acao", [empresa]);
  assert.deepEqual(eventos.rows.map(e => e.acao), ["central.criar_empresa", "central.vincular_gestor"]);
});

test("SQL auditoria global combina filtros, pagina empates e protege dados", async () => {
  const sql = "select public.central_auditoria_global($1,$2,$3,$4,$5,$6,$7,$8) as dados";
  const filtros = [null, "Empresa 21", "CENTRAL@", "2021-05-05", "2021-05-05", null, null, 1];
  for (const identidade of [a1, loja]) await assert.rejects(como(identidade, sql, filtros), { code: "42501" });
  await assert.rejects(como(a2, sql, filtros, "service_role"), { code: "42501" });
  await assert.rejects(como(a2, sql, [...filtros.slice(0, -1), 101]), { code: "22023" });
  for (const [n, escopo, acao, data] of [
    [3100, "plataforma", "central.editar_licenca", "2021-05-06 02:59:59+00"],
    [3101, "plataforma", "central.acao_futura", "2021-05-06 02:59:59+00"],
    [3102, "loja", "central.editar_licenca", "2021-05-06 02:59:59+00"],
    [3103, "plataforma", "central.criar_empresa", "2021-05-06 03:00:00+00"]
  ]) {
    await db.query("insert into painel_privado.auditoria (id,autor_id,escopo,empresa_id,acao,entidade,entidade_id,ocorrido_em,antes,depois,motivo,requisicao_id) values ($1,$2,$3,$4,$5,'empresa',$6,$7,$8,$9,'Motivo',$10)",
      [id(n), admin, escopo, escopo === "loja" ? id(21) : null, acao, id(21), data,
        { plano: "basico", segredo: "remover" }, { plano: "pro", gestor_id: id(900) }, id(n + 100)]);
  }
  const primeira = (await como(a2, sql, filtros)).rows[0].dados;
  assert.equal(primeira.tem_proxima, true);
  assert.equal(primeira.eventos[0].acao_rotulo, "Ação central");
  assert.equal(primeira.eventos[0].depois, null);
  assert.equal(primeira.eventos[0].motivo, null);
  const cursor = primeira.eventos[0];
  const segunda = (await como(a2, sql, [...filtros.slice(0, 5), cursor.ocorrido_em, cursor.id, 1])).rows[0].dados;
  assert.equal(segunda.tem_proxima, false);
  assert.equal(segunda.eventos[0].acao, "central.editar_licenca");
  assert.equal(segunda.eventos[0].autor, "central@example.test");
  assert.deepEqual(segunda.eventos[0].antes, { plano: "basico" });
  assert.deepEqual(segunda.eventos[0].depois, { plano: "pro" });
  const filtrada = (await como(a2, sql, ["central.acao_futura", ...filtros.slice(1)])).rows[0].dados;
  assert.equal(filtrada.eventos.length, 1);
});

test("SQL autorização e mudança de recebedor MP", async () => {
  const status = "select public.loja_status_credencial_mp($1,'producao') as dados";
  const central = "select public.central_status_credencial_mp($1,'producao') as dados";
  const salvar = "select public.servico_gravar_credencial_mp($1,'producao',$2,$3,$4,null,$5) as dados";
  const aprovar = "select public.central_aprovar_recebedor_mp($1,$2,$3,$4,$5) as dados";
  const envelope = "v1.fixture." + "a".repeat(55);
  const gravar = (recebedor, revisao) => como({}, salvar, [alvo, gestor, recebedor, envelope, revisao], "service_role");
  await assert.rejects(como(loja, status, [id(2)]), { code: "42501" });
  await assert.rejects(como(loja, salvar, [alvo, gestor, "20", envelope, 0]), { code: "42501" });
  await assert.rejects(como(a1, central, [alvo]), { code: "42501" });
  assert.equal((await gravar("20", 0)).rows[0].dados.estado, "ativa");
  assert.equal((await gravar("20", 1)).rows[0].dados.estado, "ativa");
  assert.equal((await gravar("21", 2)).rows[0].dados.estado, "pendente");
  const ficha = (await como(a2, central, [alvo])).rows[0].dados;
  assert.equal(ficha.recebedor_pendente, "21");
  assert.ok(!JSON.stringify(ficha).includes(envelope));
  const args = [alvo, ficha.pendente, 3, "telefone", "Confirmado no contato cadastrado"];
  await assert.rejects(como(loja, aprovar, args), { code: "42501" });
  await assert.rejects(como(a2, aprovar, [alvo, ficha.pendente, 2, "telefone", "Confirmado"]), { code: "23505" });
  await como(a2, aprovar, args);
  const ativa = await db.query("select recebedor from painel_privado.credenciais_mp where empresa_id=$1 and estado='ativa'", [alvo]);
  assert.deepEqual(ativa.rows, [{ recebedor: "21" }]);
  const trilha = await db.query("select depois from painel_privado.auditoria where acao='central.aprovar_recebedor_mp'");
  assert.deepEqual(trilha.rows, [{ depois: { ambiente: "producao", revisao: 3, canal: "telefone" } }]);
});

test("cofre MP autentica o contexto da empresa, conta e ambiente", () => {
  const anterior = process.env.MP_PEDIDOS_COFRE_V1;
  process.env.MP_PEDIDOS_COFRE_V1 = Buffer.alloc(32, 23).toString("base64url");
  try {
    const destino = { empresa: alvo, ambiente: "producao", recebedor: "21" };
    const segredos = { access_token: "token-de-fixture", webhook_secret: "segredo-de-fixture" };
    const cifra = cifrarCredencialMP(segredos, destino);
    assert.ok(!cifra.includes(segredos.access_token));
    assert.deepEqual(decifrarCredencialMP(cifra, destino), segredos);
    for (const alteracao of [{ empresa: id(2) }, { ambiente: "sandbox" }, { recebedor: "22" }]) {
      assert.throws(() => decifrarCredencialMP(cifra, { ...destino, ...alteracao }));
    }
  } finally {
    if (anterior === undefined) delete process.env.MP_PEDIDOS_COFRE_V1;
    else process.env.MP_PEDIDOS_COFRE_V1 = anterior;
  }
});
