
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(process.argv[2] || ".");
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
    if (!file.startsWith(root + path.sep)) throw Error("Caminho inválido");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    if (file.endsWith("monitor.html")) res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const casos = ["sessao", "login", "login-falha", "401", "403", "500", "rede", "vazio", "troca-loja", "troca-dia", "logout", "logout-falha", "eventos"];
try {
  for (const caso of casos) {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    if (caso === "eventos") await page.clock.install();
    const erros = [], chamadas = [];
    let consultas = 0, liberar, iniciou;
    const espera = new Promise(resolve => { liberar = resolve; });
    const consultando = new Promise(resolve => { iniciou = resolve; });
    page.on("pageerror", e => erros.push(e.message));
    await page.route("**/api/monitor-gestor", async route => {
      const pedido = route.request().postDataJSON();
      chamadas.push(pedido);
      assert.equal(route.request().method(), "POST");
      const lojas = [{ id: "loja-a", nome: "Loja A" }, { id: "loja-b", nome: "Loja B" }];
      if (pedido.acao === "lojas" || pedido.acao === "entrar") {
        if ((caso.startsWith("login") && pedido.acao === "lojas") || caso === "login-falha") {
          return route.fulfill({ status: 401, json: { erro: "Credenciais inválidas" } });
        }
        return route.fulfill({ json: { lojas: caso === "troca-loja" ? lojas : lojas.slice(0, 1) } });
      }
      if (pedido.acao === "sair") return route.fulfill(caso === "logout-falha" ?
        { status: 500, json: { erro: "Falha simulada" } } : { status: 204 });
      assert.equal(pedido.acao, "consultar");
      const indice = ++consultas;
      iniciou();
      if (indice === 1 && ["troca-loja", "troca-dia", "logout"].includes(caso)) await espera;
      if (indice > 1 && ["401", "403", "500"].includes(caso)) return route.fulfill({ status: Number(caso), json: { erro: "Sessão inválida" } });
      if (indice > 1 && caso === "rede") return route.abort();
      const vazio = caso === "vazio", antigo = indice === 1 && caso.startsWith("troca-");
      const data = "2026-11-18T12:00:00-03:00";
      await route.fulfill({ json: {
        pedidos_total: vazio ? 0 : 11, pedidos: vazio ? [] : [{ comanda: antigo ? 999 : 42, estado: "novo", pagamento: "no_caixa", total_centavos: 1250, criado_em: data }],
        recebimentos_total: vazio ? 0 : 2, recebimentos: vazio ? [] : [{ comanda: 42, meio: "pix", origem: "caixa", valor: 500, recebido_em: data }],
        entregas_total: vazio ? 0 : 1, entregas: vazio ? [] : [{ comanda: 43, entrega: "em_rota", pagamento: "na_entrega", total_centavos: 1750, criado_em: data }],
        em_preparo: 3, recebido_caixa: 1000, recebido_online: 500, em_rota: 2, entregues: 4,
        alertas_saldo_remo: vazio ? [] : [{ comanda: 44, atualizado_em: data }]
      } });
    });
    await page.goto(base + "/monitor.html");
    if (caso.startsWith("login")) {
      await page.locator("#login-monitor").waitFor();
      await page.locator("#email-monitor").fill("teste@example.com");
      await page.locator("#senha-monitor").fill("senha-teste");
      await page.locator("#login-monitor button").click();
      if (caso === "login-falha") {
        await page.locator("#aviso-monitor").filter({ hasText: "Credenciais inválidas" }).waitFor();
        assert.equal(await page.locator("#senha-monitor").inputValue(), "");
        assert.deepEqual(erros, []);
        console.log("PASS", caso);
        await page.close();
        continue;
      }
    }
    await page.locator("#painel-monitor").waitFor();
    if (["troca-loja", "troca-dia", "logout"].includes(caso)) {
      await consultando;
      if (caso === "logout") {
        await page.locator("#sair-monitor").click();
        assert.equal(chamadas.some(c => c.acao === "sair"), false);
      } else if (caso === "troca-loja") await page.locator("#loja-monitor").selectOption("loja-b");
      else await page.locator("#dia-monitor").fill("2026-11-17");
      if (caso !== "logout") {
        assert.equal(consultas, 1);
        await page.evaluate(() => {
          window.textosMonitor = [];
          new MutationObserver(() => window.textosMonitor.push(document.getElementById("lista-monitor").textContent))
            .observe(document.getElementById("lista-monitor"), { childList: true });
        });
      }
      liberar();
    }
    if (caso === "logout") {
      await page.locator("#login-monitor").waitFor();
      await page.locator("#aviso-monitor").filter({ hasText: "Você saiu" }).waitFor();
      assert.equal(await page.locator("#loja-monitor option").count(), 0);
    } else {
      await page.locator("#dados-monitor").waitFor();
      await page.waitForFunction(() => !document.getElementById("atualizar-monitor").disabled);
      if (caso.startsWith("troca-")) {
        await page.locator("#lista-monitor").filter({ hasText: "#42" }).waitFor();
        assert.equal(await page.evaluate(() => window.textosMonitor.some(t => t.includes("#999"))), false);
        assert.equal(consultas, 2);
        assert.equal(chamadas.at(-1)[caso === "troca-loja" ? "empresa" : "dia"], caso === "troca-loja" ? "loja-b" : "2026-11-17");
      }
      if (["401", "403", "500", "rede"].includes(caso)) {
        await page.locator("#atualizar-monitor").click();
        await page.locator("#aviso-monitor").filter({ hasText: ["401", "403"].includes(caso) ? "Sessão inválida" : "A atualização falhou" }).waitFor();
        assert.equal(await page.locator("#login-monitor").isVisible(), ["401", "403"].includes(caso));
      } else if (caso === "logout-falha") {
        await page.locator("#sair-monitor").click();
        await page.locator("#aviso-monitor").filter({ hasText: "Não foi possível sair" }).waitFor();
        assert.equal(await page.locator("#painel-monitor").isVisible(), true);
      } else {
        assert.match(await page.locator("#recebido-monitor").textContent(), /15,00/);
        if (caso === "vazio") await page.locator("#nota-lista-monitor").filter({ hasText: "Nenhum registro" }).waitFor();
        else {
          await page.locator('[data-aba="recebimentos"]').click();
          assert.match(await page.locator("#lista-monitor").textContent(), /Pedido #42 · Pix.*Caixa/);
          assert.match(await page.locator("#nota-lista-monitor").textContent(), /1 registros mais recentes de 2/);
          await page.locator('[data-aba="entregas"]').click();
          assert.match(await page.locator("#lista-monitor").textContent(), /Em rota · Pagamento na entrega/);
          assert.match(await page.locator("#lista-alertas-saldo-monitor").textContent(), /Pedido #44/);
        }
        if (caso === "eventos") {
          for (const tipo of ["online", "visibilitychange", "intervalo"]) {
            const antes = consultas;
            const resposta = page.waitForResponse(r => r.url().endsWith("/api/monitor-gestor") && r.request().postDataJSON()?.acao === "consultar");
            if (tipo === "intervalo") await page.clock.fastForward(20000);
            else await page.evaluate(t => (t === "online" ? window : document).dispatchEvent(new Event(t)), tipo);
            await resposta;
            await page.waitForFunction(() => !document.getElementById("atualizar-monitor").disabled);
            assert.equal(consultas, antes + 1);
          }
        }
      }
    }
    assert.deepEqual(erros, []);
    console.log("PASS", caso);
    await page.close();
  }
  console.log(casos.length + " fluxos do monitor em Chrome aprovados.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
