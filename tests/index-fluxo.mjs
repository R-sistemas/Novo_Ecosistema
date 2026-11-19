
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(process.argv[2] || ".");
const original = execFileSync("git", ["show", "d50ab7f:index.html"], { encoding: "utf8" });
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(root + path.sep)) throw Error("Caminho inválido");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const estrutura = () => {
  const serializar = node => node.nodeType === Node.TEXT_NODE ?
    node.textContent.trim() || null : node.nodeType === Node.ELEMENT_NODE ?
      [node.localName, [...node.attributes].map(a => [a.name, a.value]).sort(),
        [...node.childNodes].map(serializar).filter(Boolean)] : null;
  return serializar(document.body);
};
let testes = 0;
try {
  const dom = await browser.newPage();
  await dom.route("**/pdv.mjs", route => route.fulfill({
    contentType: "text/javascript", body: "window.pdvCarregado = true;"
  }));
  await dom.goto(base + "/");
  await dom.waitForFunction(() => window.pdvCarregado && !document.getElementById("login").inert);
  const atual = await dom.evaluate(estrutura);
  await dom.setContent(original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
  assert.deepEqual(atual, await dom.evaluate(estrutura));
  console.log("PASS DOM completo, atributos, textos e hierarquia iguais à base");
  testes++;
  await dom.close();

  for (const area of ["vendas", "administracao"]) {
    const page = await browser.newPage();
    const errors = [], chamadas = [];
    let aberto = false;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**", async route => {
      const req = route.request(), url = new URL(req.url()), nome = url.pathname.split("/").at(-1);
      const dados = req.method() === "POST" ? req.postDataJSON() : null;
      chamadas.push({ nome, dados });
      let json;
      if (url.pathname.includes("/auth/")) json = { access_token: "token-teste", refresh_token: "refresh-teste", expires_in: 3600, user: { id: "usuario-teste" } };
      else if (url.pathname.includes("/rpc/")) {
        if (nome === "abrir_caixa") { aberto = true; json = "caixa-teste"; }
        else if (nome === "registrar_venda_com_desconto") json = 1250;
        else if (nome === "pix_frente_disponivel") json = false;
        else if (nome === "listar_terminais_gestor") json = [{ id: "terminal-teste", nome: "Caixa teste", email: "teste@example.com" }];
        else if (nome === "configurar_mesa_cardapio") json = { loja: "loja-teste", mesa: 7 };
        else if (nome === "recebimentos_online_da_loja") json = { quantidade: 0, total_centavos: 0, frete_centavos: 0, pedidos: [] };
        else json = [];
      } else if (nome === "empresas") json = [{ id: "empresa-teste", nome: "Loja teste", nome_pdv: "PDV teste",
        pagamento_na_entrega: true, cardapio_cor: "#175d2d", cardapio_fundo: "#f4f6f2" }];
      else if (nome === "membros") json = [{ empresa_id: "empresa-teste" }];
      else if (nome === "produtos") json = [{ id: "produto-teste", codigo: "101", nome: "Produto teste",
        preco_centavos: 1250, categoria: "Produtos", vendido_por_peso: false }];
      else if (nome === "terminais_pdv") json = [{ id: "terminal-teste", nome: "Caixa teste" }];
      else if (nome === "caixas") json = aberto ? [{ id: "caixa-teste", terminal_id: "terminal-teste", abertura_centavos: 1000, fechado_em: null }] : [];
      else json = [];
      await route.fulfill({ json });
    });
    await page.goto(base + "/index.html");
    await page.locator("#login").waitFor();
    await page.waitForFunction(() => !document.getElementById("login").inert);
    await page.locator("#email").fill("teste@example.com");
    await page.locator("#password").fill("senha-teste");
    await page.locator("#entrada").selectOption(area);
    await page.locator("#login button").click();
    await page.locator("#area-" + area).waitFor();
    if (area === "vendas") {
      await page.locator("#amount").fill("10");
      await page.getByRole("button", { name: "Abrir caixa", exact: true }).click();
      await page.locator("#status").filter({ hasText: "Caixa aberto" }).waitFor();
      await page.locator("#abrir-produtos").click();
      await page.locator("#products button").filter({ hasText: "Produto teste" }).click();
      await page.locator("#cart").filter({ hasText: "Produto teste" }).waitFor();
      await page.locator("#abrir-pagamento-pdv").click();
      await page.locator('[data-meio-pdv="Dinheiro"]').click();
      await page.locator("#valor-recebido-frente").fill("20");
      await page.locator("#finish").click();
      await page.locator("#notice").filter({ hasText: "Venda registrada" }).waitFor();
      assert.equal(chamadas.filter(c => c.nome === "registrar_venda_com_desconto").length, 1);
      assert.equal(chamadas.find(c => c.nome === "abrir_caixa").dados.p_abertura, 1000);
    } else {
      await page.locator('[data-admin-abrir="configurar-mesa"]').click();
      await page.locator("#numero-mesa").fill("7");
      await page.locator("#configurar-mesa button").click();
      await page.locator("#resultado-mesa").waitFor();
      assert.match(await page.locator("#link-mesa").inputValue(), /cardapio\.html\?loja=loja-teste&mesa=7/);
      await page.locator("dialog[open] .admin-modal-fechar").click();
      await page.locator('[data-admin-abrir="cadastrar-operador"]').click();
      await page.locator("#novo-operador-perfil").selectOption("cozinha");
      assert.equal(await page.locator("#novo-operador-terminal").isVisible(), false);
    }
    assert.deepEqual(errors, []);
    console.log("PASS", area, "login e operação com serviços simulados");
    testes++;
    await page.close();
  }
  if (await fs.stat(path.join(root, "pdv/partes/administracao.html")).catch(() => null)) {
    for (const falha of ["http", "rede", "vazio", "invalido"]) {
      const page = await browser.newPage();
      let iniciou = false, primeira = true;
      await page.route("**/pdv.mjs", async route => { iniciou = true; await route.fulfill({ contentType: "text/javascript", body: "window.pdvCarregado = true;" }); });
      await page.route("**/pdv/partes/administracao.html", async route => {
        if (!primeira) return route.fulfill({ contentType: "text/html", body: await fs.readFile(path.join(root, "pdv/partes/administracao.html"), "utf8") });
        primeira = false;
        if (falha === "http") return route.fulfill({ status: 503, body: "Indisponível" });
        if (falha === "rede") return route.abort();
        return route.fulfill({ contentType: "text/html", body: falha === "vazio" ? "" : "<section id=outro>Inválido</section>" });
      });
      await page.goto(base + "/");
      await page.locator("#notice").filter({ hasText: "Não foi possível" }).waitFor();
      assert.equal(iniciou, false);
      assert.equal(await page.locator("#login").evaluate(e => e.inert), true);
      await page.getByRole("button", { name: "Recarregar" }).waitFor();
      if (falha === "http") {
        await page.getByRole("button", { name: "Recarregar" }).click();
        await page.waitForFunction(() => window.pdvCarregado && !document.getElementById("login").inert);
        assert.equal(await page.locator("#area-administracao").count(), 1);
        console.log("PASS recarregar após falha recupera a página");
        testes++;
      }
      console.log("PASS falha de partial", falha, "mantém login bloqueado e permite recarregar");
      testes++;
      await page.close();
    }
  }
  if (await fs.stat(path.join(root, "pdv/partes/administracao.html")).catch(() => null)) {
    const page = await browser.newPage();
    let liberar, recebido;
    const espera = new Promise(resolve => { liberar = resolve; });
    const solicitada = new Promise(resolve => { recebido = resolve; });
    await page.route("**/pdv/partes/administracao.html", async route => {
      recebido();
      await espera;
      await route.fulfill({ contentType: "text/html", body: await fs.readFile(path.join(root, "pdv/partes/administracao.html"), "utf8") });
    });
    await page.route("**/pdv.mjs", route => route.fulfill({ contentType: "text/javascript", body: "window.pdvCarregado = Boolean(document.getElementById('area-administracao'));" }));
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await solicitada;
    assert.equal(await page.locator("#login").evaluate(e => e.inert), true);
    assert.equal(await page.evaluate(() => Boolean(window.pdvCarregado)), false);
    liberar();
    await page.waitForFunction(() => window.pdvCarregado && !document.getElementById("login").inert);
    console.log("PASS PDV aguarda o partial antes de iniciar");
    testes++;
    await page.close();
  }
  console.log(testes + " verificações em Chrome aprovadas.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
