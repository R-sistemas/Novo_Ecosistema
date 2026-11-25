
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
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port + "/cardapio.html?loja=empresa-entrega";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  for (const caso of ["validacao", "pix", "dinheiro", "credito", "frete-alterado", "conflito", "repeticao", "metodos", "pino", "memoria", "limpeza", "armazenamento"]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    if (caso === "armazenamento") await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw Error("Sem armazenamento"); } });
    });
    const errors = [], pagamentos = [], cotacoes = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg==", "base64")
    }));
    await page.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**", async route => {
      const nome = route.request().url().split("/").at(-1);
      const json = nome === "ver_cardapio" ? {
        nome: "Loja com entrega", oferece_entrega: true, mapa_centro: { latitude: -16.68, longitude: -49.26 },
        produtos: [{ id: "produto", nome: "Produto teste", preco_centavos: 1250, categoria: "Lanches" }]
      } : nome === "metodos_checkout_publico" ? { pix: caso !== "metodos", credito: caso !== "metodos", debito: false } :
        nome === "pagamento_na_entrega_disponivel" ? caso !== "metodos" :
          nome === "acompanhar_pedido" ? { estado: "novo", comanda: 42, total_centavos: 1750 } : null;
      if (nome === "opcoes_mp_cardapio") { await route.fulfill({json:null}); return; }
      assert.notEqual(json, null, nome);
      await route.fulfill({ json });
    });
    await page.route("**/credito-teste.mjs", route => route.fulfill({
      contentType: "text/javascript",
      body: 'export async function abrirCreditoTeste(dados, confirmar, producao) { window.creditoSimulado = { dados, producao }; await confirmar(dados.pedido.p_id); }'
    }));
    await page.route("**/api/**", async route => {
      const nome = new URL(route.request().url()).pathname;
      const dados = route.request().postDataJSON();
      if (nome === "/api/cotar-frete") {
        cotacoes.push(dados);
        const indiceCotacao = cotacoes.length;
        const mudou = (caso === "frete-alterado" && cotacoes.length >= 2) ||
          (caso === "conflito" && pagamentos.length >= 1);
        if (caso === "pino" && indiceCotacao === 1) await new Promise(r => setTimeout(r, 1000));
        await route.fulfill({ json: { frete_centavos: caso === "pino" && cotacoes.length === 1 ? 90000 : mudou ? 700 : 500 } }).catch(() => {});
      } else {
        assert.equal(nome, "/api/checkout-pix-mercado-pago-quiosque");
        pagamentos.push(dados);
        if (caso === "repeticao" && pagamentos.length === 1) {
          await route.fulfill({ status: 503, json: { erro: "Falha simulada" } });
        } else if (caso === "conflito" && pagamentos.length === 1) {
          await route.fulfill({ status: 409, json: { erro: "Frete mudou", frete_centavos: 700 } });
        } else await route.fulfill({ json: { pedido: dados.p_id, imagem: "aGVsbG8=", copiaECola: "PIX-TESTE" } });
      }
    });
    async function abrir() {
      await page.goto(base);
      await page.locator('[aria-label^="Adicionar "]').first().click();
      await page.locator("#ver-pedido").click();
      await page.locator(".leaflet-container").waitFor();
    }
    await abrir();
    if (caso === "validacao" && process.env.ENTREGA_CAPTURAS) {
      await page.screenshot({ path: path.join(process.env.ENTREGA_CAPTURAS, "checkout-entrega-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.ENTREGA_CAPTURAS, "checkout-entrega-mobile.png") });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    if (caso === "validacao") {
      await page.locator("#enviar-pedido").click();
      assert.equal(await page.locator('[name="nome"]').getAttribute("aria-invalid"), "true");
      assert.equal(await page.locator('[name="telefone"]').getAttribute("aria-invalid"), "true");
    }
    await page.locator('[name="nome"]').fill("Cliente teste");
    await page.locator('[name="telefone"]').fill("+55 62 99999-9999");
    if (caso === "validacao") {
      await page.locator("#enviar-pedido").click();
      await page.locator(".checkout-localizacao-invalida").waitFor();
      assert.equal(pagamentos.length, 0);
    }
    const mapa = page.locator(".leaflet-container");
    await mapa.click({ position: { x: 140, y: 100 } });
    if (caso === "pino") {
      await page.waitForTimeout(550);
      await mapa.click({ position: { x: 190, y: 130 } });
    }
    if (["memoria", "armazenamento"].includes(caso)) await page.locator('[name="lembrar"]').check();
    await page.locator(".checkout-resumo").filter({ hasText: "17,50" }).waitFor();
    if (caso === "pino") await page.waitForTimeout(1100);
    await page.locator("#enviar-pedido").click();
    await page.getByRole("heading", { name: "Como deseja pagar?" }).waitFor();
    if (caso === "metodos") {
      for (const metodo of ["pix", "credit", "cash", "terminal"]) assert.equal(await page.locator('[data-metodo="' + metodo + '"]').isDisabled(), true);
    } else if (caso === "limpeza") {
      await page.locator('[data-metodo="pix"]').click();
      await page.getByRole("button", { name: "Alterar entrega ou contato" }).click();
      assert.equal(await page.locator('[name="nome"]').inputValue(), "Cliente teste");
      await page.locator("#limpar-carrinho").click();
      await page.locator('[aria-label^="Adicionar "]').first().click();
      await page.locator("#ver-pedido").click();
      assert.equal(await page.locator('[name="nome"]').inputValue(), "");
      assert.equal(await page.locator(".leaflet-marker-icon").count(), 0);
    } else if (caso !== "validacao") {
      const metodo = ["dinheiro", "conflito"].includes(caso) ? "cash" : caso === "credito" ? "credit" : "pix";
      await page.locator('[data-metodo="' + metodo + '"]').click();
      if (metodo === "cash") {
        await page.locator('[name="troco"]').fill("10");
        await page.locator("#enviar-pedido").click();
        assert.equal(await page.locator('[name="troco"]').getAttribute("aria-invalid"), "true");
        await page.locator('[name="troco"]').fill("20,00");
      }
      await page.locator("#enviar-pedido").click();
      if (["frete-alterado", "conflito"].includes(caso)) {
        await page.getByRole("heading", { name: "A taxa de entrega mudou" }).waitFor();
        assert.equal(pagamentos.length, caso === "conflito" ? 1 : 0);
        await page.locator("#checkout-aceitar-frete").click();
        await page.locator("#enviar-pedido").click();
      }
      if (caso === "repeticao") {
        await page.locator("#erro-pedido").filter({ hasText: "Falha simulada" }).waitFor();
        await page.locator("#enviar-pedido").click();
        await page.waitForURL(/pedido=/);
        assert.equal(pagamentos[0].p_id, pagamentos[1].p_id);
      }
      await page.waitForURL(/pedido=/);
      if (caso === "credito") {
        const credito = await page.evaluate(() => window.creditoSimulado);
        assert.equal(credito.dados.totalCentavos, 1750);
        assert.equal(credito.producao, true);
      } else {
        const envio = pagamentos.at(-1);
        assert.equal(envio.endereco.telefone, "62999999999");
        assert.equal(envio.frete_centavos, ["frete-alterado", "conflito"].includes(caso) ? 700 : 500);
        assert.equal(envio.endereco.metodo_pagamento, metodo === "cash" ? "dinheiro" : "pix");
        if (metodo === "cash") assert.equal(envio.endereco.troco_para_centavos, 2000);
        if (caso === "pino") assert.equal(envio.endereco.maps_url, cotacoes.at(-1).endereco.maps_url);
      }
      if (caso === "memoria") {
        await abrir();
        assert.equal(await page.locator('[name="nome"]').inputValue(), "Cliente teste");
        assert.equal(await page.locator('[name="telefone"]').inputValue(), "+55 62 99999-9999");
        assert.equal(await page.locator('[name="lembrar"]').isChecked(), true);
        await page.locator(".leaflet-marker-icon").waitFor();
      }
    }
    assert.deepEqual(errors, []);
    console.log("PASS", caso);
    await page.close();
  }
  console.log("12 fluxos de checkout em Chrome aprovados.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
