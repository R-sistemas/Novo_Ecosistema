
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const raiz = path.resolve(process.argv[2] || ".");
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(raiz, "." + new URL(req.url, "http://localhost").pathname);
    if (!file.startsWith(raiz + path.sep)) throw new Error("Caminho inválido");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
let testes = 0;
try {
  for (const caso of ["retirada", "mesa", "pix", "retomar", "entrega", "vazio", "credito", "retomar-pix", "pix-repetir", "quiosque", "fechado", "retomar-fechado", "credito-multiloja", "credito-sandbox-balcao", "credito-sandbox-mesa", "credito-producao-mesa"]) {
    const page = await browser.newPage();
    const sandboxCartao = caso.startsWith("credito-sandbox") || caso === "credito";
    const mesaCartao = caso.endsWith("-mesa");
    const errors = [];
    const chamadas = [];
    page.on("pageerror", e => errors.push(e.message));
    const pedido = { comanda: 42, estado: "novo", total_centavos: 1250, pago: false };
    await page.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**", async route => {
      const nome = route.request().url().split("/").at(-1);
      const dados = route.request().postDataJSON();
      chamadas.push({ nome, dados });
      let json;
      if (nome === "ver_cardapio") json = {
        nome: "Loja de teste", sandbox_checkout: dados.p_slug === "loja-teste", oferece_entrega: caso === "quiosque", fechado: caso.endsWith("fechado"), produtos: (caso === "vazio" || caso.endsWith("fechado")) ? [] : [
          { id: "produto-teste", nome: "Produto de teste", preco_centavos: 1250, categoria: "Lanches" }
        ]
      };
      else if (nome === "opcoes_mp_cardapio") json = caso.startsWith("credito") ? { pix:true, credito:true, ambiente:sandboxCartao ? "sandbox" : "producao", chave_publica:sandboxCartao ? "chave-sandbox" : "chave-producao" } : null;
      else if (nome === "enviar_pedido") json = "pedido-teste";
      else if (nome === "acompanhar_pedido") json = {
        ...pedido, mesa: caso === "mesa" ? "7" : null,
        pix_sandbox: caso.startsWith("pix") || caso === "retomar-pix", pix_confirmado: false
      };
      else if (nome === "pagamento_na_entrega_disponivel") json = true;
      else throw new Error("RPC inesperada " + nome);
      await route.fulfill({ json });
    });
    await page.route("**/api/**", async route => {
      const nome = new URL(route.request().url()).pathname;
      chamadas.push({ nome, dados: route.request().postDataJSON() });
      const json = nome === "/api/cotar-frete" ? { frete_centavos: 500 } :
        { imagem: "aGVsbG8=", copiaECola: "PIX-TESTE", pedido: "pedido-teste" };
      if (caso === "pix-repetir" && nome.includes("checkout-pix") && chamadas.filter(c => c.nome === nome).length === 1) {
        await route.fulfill({ status: 503, json: { erro: "Falha simulada" } });
      } else await route.fulfill({ json });
    });
    await page.route("https://sdk.mercadopago.com/js/v2", route => route.fulfill({
      contentType: "text/javascript",
      body: 'window.MercadoPago = class { constructor(chave) { this.chave = chave; } bricks() { return { create: async (_,__,config) => { window.creditoSimulado = {chave:this.chave, valor:config.initialization.amount}; window.enviarCartao = () => config.callbacks.onSubmit({ token:"cartao-fixture", payment_method_id:"visa", payer:{email:"teste@example.invalid"} }); config.callbacks.onReady(); } }; } };'
    }));
    await page.route("**/checkout-entrega.mjs", route => route.fulfill({
      contentType: "text/javascript",
      body: 'export async function iniciarCheckoutEntrega(ctx) { window.checkoutSimulado = { slug: ctx.slug, callbacks: [typeof ctx.aoPix, typeof ctx.aoConfirmar] }; await ctx.aoConfirmar("pedido-entrega", "pix"); }'
    }));
    const consulta = caso.startsWith("credito") ? "?loja=" + (sandboxCartao ? "loja-teste" : "empresa-mp") + (mesaCartao ? "&mesa=7" : "") + (caso === "credito" ? "&cartao=credito" : "") : caso === "quiosque" ? "?loja=quiosque-dorafa" : caso === "entrega" ? "?loja=loja-teste&entrega=teste" :
      caso === "retomar-pix" ? "?loja=loja-teste&pedido=pedido-teste" :
      caso.startsWith("pix") ? "?loja=loja-teste" :
      caso === "mesa" ? "?loja=loja-teste&mesa=7" :
      caso === "retomar" || caso === "retomar-fechado" ? "?loja=loja-teste&pedido=pedido-teste" : "?loja=loja-teste";
    await page.goto(base + "/cardapio.html" + consulta);
    await page.getByText("Loja de teste", { exact: true }).first().waitFor();
    if (caso === "fechado") {
      await page.getByText("Loja fechada para novos pedidos.", { exact: true }).waitFor();
      assert.equal(chamadas.filter(c => c.nome === "enviar_pedido").length, 0);
      if (process.env.CENTRAL_1B_CAPTURAS) {
        await page.screenshot({ path: path.join(process.env.CENTRAL_1B_CAPTURAS, "cardapio-fechado-desktop.png") });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(process.env.CENTRAL_1B_CAPTURAS, "cardapio-fechado-mobile.png") });
      }
    } else if (caso === "vazio") {
      await page.getByText("Nenhum produto disponível.", { exact: true }).waitFor();
    } else if (caso.startsWith("retomar") || caso === "quiosque") {
      await page.locator("#mensagem").filter({ hasText: /Recebido|Aguardando/ }).waitFor();
      if (caso === "retomar-pix") {
        await page.locator("#pagamento-pix").waitFor();
        assert.equal(await page.locator("#pix-codigo").inputValue(), "PIX-TESTE");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.getByRole("button", { name: "Copiar Pix" }).click();
        await page.getByText("Código Pix copiado.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "PIX-TESTE");
      }
      if (caso === "retomar") {
        const atual = page.locator('#etapas-pedido [aria-current="step"]');
        assert.equal(await atual.textContent(), "Recebido");
        pedido.estado = "preparo";
        await atual.filter({ hasText: "Em preparo" }).waitFor();
        for (const [estado, estado_remo, titulo] of [
          ["pronto", null, "Pronto"],
          ["pronto", "em_rota", "A caminho"],
          ["pronto", "entregue", "Entregue"]
        ]) {
          Object.assign(pedido, { estado, estado_remo });
          await page.locator("#acompanhar").click();
          await atual.filter({ hasText: titulo }).waitFor();
        }
        const voltar = page.getByRole("link", { name: "Voltar ao cardápio" });
        await voltar.click();
        await page.locator('[aria-label*="Adicionar"]').first().waitFor();
        assert.equal(new URL(page.url()).searchParams.has("pedido"), false);
      }
      assert.equal(chamadas.filter(c => c.nome === "enviar_pedido").length, 0);
      if (caso === "quiosque") {
        assert.deepEqual(await page.evaluate(() => window.checkoutSimulado), { slug: "quiosque-dorafa", callbacks: ["function", "function"] });
        assert.match(page.url(), /entrega=sim/);
        assert.match(page.url(), /pix=mercado-pago/);
      }
    } else {
      await page.locator('[aria-label*="Adicionar"]').first().click();
      await page.locator("#ver-pedido").click();
      await page.locator("#cliente").fill("Cliente de teste");
      if (caso.startsWith("pix")) await page.locator("#opcao-pix").click();
      if (caso.startsWith("credito") && caso !== "credito") await page.locator((mesaCartao ? "#pagamento-mesa" : "#pagamento-padrao") + " [data-pagamento=credito-mp]").click();
      if (caso === "entrega") {
        for (const [nome, valor] of Object.entries({ logradouro: "Rua Teste", numero: "10", bairro: "Centro", cidade: "Cidade Teste" })) {
          await page.locator('#entrega-teste input[name="' + nome + '"]').fill(valor);
        }
        await page.locator("#cliente").click();
        await page.locator("#frete-cotacao").filter({ hasText: "R$" }).waitFor();
      }
      await page.locator("#enviar-pedido").click();
      if (caso.startsWith("credito")) {
        await page.waitForFunction(() => Boolean(window.enviarCartao));
        await page.evaluate(() => window.enviarCartao());
      }
      if (caso === "pix-repetir") {
        await page.locator("#erro-pedido").filter({ hasText: "Falha simulada" }).waitFor();
        await page.locator("#enviar-pedido").click();
      }
      try {
        await page.locator("#mensagem").filter({ hasText: /Recebido|Aguardando/ }).waitFor();
      } catch (erro) {
        console.log(caso, await page.locator("#erro-pedido").textContent(), await page.locator("#mensagem").textContent(), chamadas);
        throw erro;
      }
      if (caso.startsWith("pix") || caso === "entrega") {
        assert.ok(chamadas.some(c => c.nome.includes("checkout-pix")));
        if (caso === "pix-repetir") {
          const pix = chamadas.filter(c => c.nome.includes("checkout-pix"));
          assert.equal(pix.length, 2);
          assert.equal(pix[0].dados.p_id, pix[1].dados.p_id);
        }
      } else if (caso.startsWith("credito")) {
        const chave = sandboxCartao ? "chave-sandbox" : "chave-producao";
        assert.deepEqual(await page.evaluate(() => window.creditoSimulado), {chave, valor:12.5});
        const envio = chamadas.find(c => c.nome.includes("checkout-credito"));
        assert.equal(envio.nome, "/api/checkout-credito-mercado-pago-" + (sandboxCartao ? "teste" : "quiosque"));
        assert.equal(envio.dados.chave_publica, chave);
        assert.equal(envio.dados.p_mesa, mesaCartao ? "7" : null);
      } else {
        const envio = chamadas.find(c => c.nome === "enviar_pedido");
        assert.equal(envio.dados.p_cliente, "Cliente de teste");
        assert.equal(envio.dados.p_itens[0].produto_id, "produto-teste");
      }
      if (caso === "mesa") await page.locator("#mensagem").filter({ hasText: "Mesa 7" }).waitFor();
      assert.match(page.url(), /pedido=/);
    }
    assert.deepEqual(errors, []);
    console.log("PASS", caso);
    testes++;
    await page.close();
  }

  const contexto = await browser.newContext();
  const kds = await contexto.newPage();
  const cardapio = await contexto.newPage();
  const avisos = [];
  const pedidoEntrega = "7d94b9fd-080d-4caa-817a-284f835cbb7f";
  const pedidoMesa = "55a28c5b-ad69-4cdc-baed-ab2a4f22ecf6";
  const ativo = {cliente:"Teste",estado:"preparo",itens:[{nome:"Lanche",quantidade:1}],pode_avisar:true};
  const mensagens = "Sem maionese <b>podemos trocar?</b>";
  const falhas = [];
  for (const pagina of [kds,cardapio]) pagina.on("pageerror",e=>falhas.push(e.message));
  await contexto.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async route=>{
    const nome = new URL(route.request().url()).pathname.split("/").at(-1);
    const dados = route.request().postDataJSON();
    if (nome === "token") return route.fulfill({json:{user:{id:"cozinha-teste"},access_token:"fixture",refresh_token:"fixture",expires_in:3600}});
    if (nome === "lojas_kds") return route.fulfill({json:[{id:"loja-teste",nome:"Loja de teste"}]});
    if (nome === "fila_cozinha") return route.fulfill({json:[
      {...ativo,id:pedidoEntrega,pagamento_entrega:"na_entrega",telefone_cliente:"11922223333",avisos},
      {...ativo,id:pedidoMesa,mesa:7,avisos:[]}
    ]});
    if (nome === "cancelamentos_recentes_kds") return route.fulfill({json:[]});
    if (nome === "pode_editar_comanda_kds") return route.fulfill({json:false});
    if (nome === "enviar_aviso_pedido") {
      assert.deepEqual(dados,{p_empresa:"loja-teste",p_pedido:pedidoEntrega,p_mensagem:mensagens});
      avisos.push({mensagem:mensagens,criado_em:"2026-11-20T15:00:00Z"});
      return route.fulfill({status:204});
    }
    if (nome === "opcoes_mp_cardapio") return route.fulfill({json:null});
    if (nome === "ver_cardapio") return route.fulfill({json:{nome:"Loja de teste",produtos:[]}});
    if (nome === "acompanhar_pedido") {
      assert.ok([pedidoEntrega,pedidoMesa].includes(dados.p_id));
      return route.fulfill({json:{estado:"preparo",total_centavos:2000,
        avisos:dados.p_id===pedidoEntrega ? avisos : []}});
    }
    throw new Error("RPC inesperada " + nome);
  });
  try {
    await kds.goto(base + "/kds.html");
    await kds.locator("#email-kds").fill("cozinha@example.invalid");
    await kds.locator("#senha-kds").fill("fixture");
    await kds.getByRole("button",{name:"Entrar na cozinha"}).click();
    const entrega = kds.locator("#fila-cozinha article").filter({hasText:"Teste · Entrega"});
    const mesa = kds.locator("#fila-cozinha article").filter({hasText:"Teste · Mesa 7"});
    const whatsapp = entrega.getByRole("link",{name:"WhatsApp"});
    await whatsapp.waitFor();
    assert.equal(await whatsapp.getAttribute("href"),"https://wa.me/5511922223333");
    assert.equal(await mesa.getByRole("link",{name:"WhatsApp"}).count(),0);
    const linkPedido = id => base + "/cardapio.html?loja=loja-teste&pedido=" + id;
    await cardapio.goto(linkPedido(pedidoEntrega));
    await cardapio.locator("#mensagem").filter({hasText:/preparo/i}).waitFor();
    assert.equal(await cardapio.locator("#avisos-pedido").count(),0);
    await entrega.getByRole("button",{name:"Avisar cliente"}).click();
    await kds.getByLabel("Mensagem para o cliente").fill(mensagens);
    await kds.getByRole("button",{name:"Enviar aviso"}).click();
    await entrega.getByText("Avisos enviados (1)",{exact:true}).click();
    await entrega.getByText(mensagens,{exact:false}).waitFor();
    await cardapio.locator("#acompanhar").click();
    await cardapio.locator("#avisos-pedido").getByText(mensagens,{exact:true}).waitFor();
    assert.equal(await cardapio.locator("#avisos-pedido b").count(),0);
    await cardapio.goto(linkPedido(pedidoMesa));
    await cardapio.locator("#mensagem").filter({hasText:/preparo/i}).waitFor();
    assert.equal(await cardapio.locator("#avisos-pedido").count(),0);
    assert.deepEqual(falhas,[]);
    console.log("PASS KDS envia aviso, WhatsApp só na entrega e Cardápio exibe no pedido correspondente");
    testes++;
  } finally {
    await contexto.close();
  }
  console.log(testes + " fluxos em Chromium aprovados.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
