import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve, sep } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const raiz = resolve(import.meta.dirname, "..");
const mime = { ".html":"text/html", ".mjs":"text/javascript", ".css":"text/css" };
const server = createServer(async (req,res) => {
  try {
    const caminho = new URL(req.url,"http://localhost").pathname;
    const arquivo = resolve(raiz,"."+(caminho === "/" ? "/index.html" : caminho));
    if (!arquivo.startsWith(raiz+sep)) throw Error("Fora do site local");
    res.setHeader("Content-Type",mime[extname(arquivo)] ?? "application/octet-stream");
    res.end(await readFile(arquivo));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch({headless:true,channel:"chrome"});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const decisoes = [], empresas = [{id:"loja-a",nome:"Loja A"},{id:"loja-b",nome:"Loja B"}];
  const ajuste = (id,comanda) => ({id,comanda,cliente:"Cliente "+comanda,
    operacao:"adicionar",quantidade:1,produto_nome:"Suco",motivo:"Solicitado",protegido:false});
  let segurarA = false;
  let respostaA;
  await page.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**", async route => {
    const url = new URL(route.request().url());
    const nome = url.pathname.split("/").at(-1);
    const dados = route.request().postDataJSON();
    if (nome === "token") return dados.password === "senha-fixture"
      ? route.fulfill({json:{user:{id:"operador-fixture"},access_token:"fixture",expires_in:3600}})
      : route.fulfill({status:400,json:{msg:"Senha inválida"}});
    if (nome === "empresas") return route.fulfill({json:url.searchParams.has("id") ? [empresas.find(e=>url.searchParams.get("id")==="eq."+e.id)] : empresas});
    if (nome === "ajustes_pendentes_caixa") {
      if (dados.p_empresa === "loja-a" && segurarA) {
        segurarA = false;
        const fila = await new Promise(resolve => { respostaA = resolve; });
        return route.fulfill({json:fila});
      }
      return route.fulfill({json:[dados.p_empresa === "loja-a" ? ajuste("ajuste-a",41) : ajuste("ajuste-b",42)]});
    }
    if (nome === "resolver_ajuste_comanda") {
      decisoes.push(dados);
      return route.fulfill({json:null});
    }
    if (nome === "recebimentos_online_da_loja") return route.fulfill({json:{quantidade:0,total_centavos:0,frete_centavos:0,pedidos:[]}});
    return route.fulfill({json:nome === "pix_frente_disponivel" ? null : []});
  });
  await page.goto("http://127.0.0.1:"+server.address().port);
  await page.locator("#email").fill("fixture@example.invalid");
  await page.locator("#password").fill("senha-fixture");
  await page.getByRole("button",{name:"Entrar"}).click();
  await page.locator("#empresa").waitFor();
  assert.equal(await page.locator("#empresa").inputValue(),"");
  await page.locator("#empresa").selectOption("loja-a");
  const lista = page.locator("#lista-ajustes-caixa");
  await lista.getByText(/Comanda 41/).waitFor();
  await lista.getByRole("button",{name:"Resolver ajuste"}).click();
  await page.locator("#resolver-ajuste-caixa[open]").waitFor();

  segurarA = true;
  await page.evaluate(() => { void import("/ajustes-caixa.mjs").then(m => m.carregarAjustesCaixa()); });
  for (let i=0; !respostaA && i<100; i++) await new Promise(resolve => setTimeout(resolve,20));
  assert.ok(respostaA,"consulta de A deve ficar pendente");
  await page.locator("#empresa").evaluate(el => {
    el.value = "loja-b";
    el.dispatchEvent(new Event("change",{bubbles:true}));
  });
  await page.locator("#resolver-ajuste-caixa[open]").waitFor({state:"detached"});
  const troca = page.locator("#troca-loja-pdv");
  await troca.waitFor();
  assert.equal(await page.locator("#empresa").inputValue(),"");
  await troca.getByLabel("Senha").fill("senha-errada");
  await troca.getByRole("button",{name:"Confirmar troca"}).click();
  await troca.getByText("Senha inválida. Confira e tente novamente.").waitFor();
  await troca.getByLabel("Senha").fill("senha-fixture");
  await troca.getByRole("button",{name:"Confirmar troca"}).click();
  await lista.getByText(/Comanda 42/).waitFor();
  const chegouA = page.waitForResponse(res => res.url().endsWith("/ajustes_pendentes_caixa") &&
    res.request().postDataJSON().p_empresa === "loja-a");
  respostaA([ajuste("ajuste-antigo",99)]);
  await chegouA;
  await page.waitForFunction(() => document.querySelector("#lista-ajustes-caixa").textContent.includes("Comanda 42"));
  assert.equal(await lista.getByText(/Comanda 41|Comanda 99/).count(),0);

  const pasta = process.env.B04_B05_CAPTURAS;
  if (pasta) {
    await page.screenshot({path:join(pasta,"pdv-loja-b-desktop.png")});
    await page.setViewportSize({width:390,height:844});
    await lista.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(pasta,"pdv-loja-b-mobile.png")});
  }
  await lista.getByRole("button",{name:"Resolver ajuste"}).click();
  await page.locator("#nota-ajuste-caixa").fill("Confirmado com o cliente");
  await page.locator("#form-resolver-ajuste").evaluate(el => el.requestSubmit());
  await page.getByText("Decisão registrada na comanda.").waitFor();
  assert.deepEqual(decisoes.map(({p_empresa,p_id})=>[p_empresa,p_id]),[["loja-b","ajuste-b"]]);
  console.log("PASS Chrome PDV: diálogo de A fecha, resposta atrasada é descartada, somente B pode ser resolvida.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
