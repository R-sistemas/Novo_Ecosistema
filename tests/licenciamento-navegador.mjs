import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {extname,resolve,sep} from "node:path";
import {test} from "node:test";

const empresa="00000000-0000-0000-0000-000000000001";
const oferta="00000000-0000-0000-0000-000000000002";
const gestor="00000000-0000-0000-0000-000000000003";
const origem="http://127.0.0.1:43212";
const raiz=resolve(import.meta.dirname,"..");
const tipos={".html":"text/html",".mjs":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"};
const cotacoes=[
  {base:60000,total:60000,parcela:60000,vezes:1,bandeira:"master"},
  {base:60000,total:68592,parcela:11432,vezes:6,bandeira:"master"}
];
const resumo={situacao:"restrita",fase:"ativa",meses:6,plano:"Básico",valido_ate:"2026-11-21",
  cobranca_ativa:true,historico:[],ofertas:[{id:oferta,plano:"Básico",meses:6,preco_centavos:60000,termos_versao:"v2"}]};
const sdk=`window.MercadoPago = class {
  fields = {
    create(tipo, opcoes) { return {
      mount(id) {
        const entrada=document.createElement("input");
        entrada.placeholder=opcoes.srLabel;
        entrada.setAttribute("aria-label",opcoes.srLabel);
        entrada.readOnly=true;
        document.getElementById(id).append(entrada);
        return this;
      },
      on(evento,fn) { if(tipo==="cardNumber" && evento==="binChange") setTimeout(()=>fn({bin:"999999"}),0); }
    }; },
    createCardToken: async () => ({id:"token-de-teste-sem-cartao"})
  };
};`;

test("Chrome apresenta as condições 1x/6x e envia somente token e cotação", {
  skip:!process.env.PAINEL_PLAYWRIGHT_MODULE || !process.env.PAINEL_CHROME_PATH
},async t => {
  const {chromium}=createRequire(import.meta.url)(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.PAINEL_CHROME_PATH,
    args:["--disable-background-networking","--disable-component-update"]});
  t.after(()=>browser.close());
  for(const viewport of [{width:1440,height:980},{width:410,height:900}]) {
    const pagina=await browser.newPage({viewport});
    let envio;
    let quitada=false;
    await pagina.route("**/*",async rota => {
      const url=new URL(rota.request().url());
      if(url.hostname==="sdk.mercadopago.com") return rota.fulfill({contentType:"text/javascript",body:sdk});
      if(url.hostname==="eyqxxlcmxlilgogxdcoq.supabase.co") {
        const json={
          "/auth/v1/token":{user:{id:gestor},access_token:"fixture",refresh_token:"fixture",expires_in:3600},
          "/rest/v1/membros":[{empresas:{id:empresa,nome:"Loja de teste"}}],
          "/rest/v1/rpc/loja_licenca_resumo":quitada?{...resumo,historico:[{estado:"confirmado",valor_centavos:60000}],ofertas:[]}:resumo,
          "/rest/v1/rpc/loja_licenca_avisos":[]
        };
        return Object.hasOwn(json,url.pathname)?rota.fulfill({json:json[url.pathname]}):rota.abort();
      }
      if(url.origin!==origem) return rota.abort();
      if(url.pathname==="/api/painel-sessao") return rota.fulfill({json:{empresa_id:empresa}});
      if(url.pathname==="/api/mercado-pago-empresa") {
        const dados=rota.request().postDataJSON();
        if(dados.acao==="config") return rota.fulfill({json:{publica:"TEST-simulada"}});
        if(dados.acao==="cotar") return rota.fulfill({json:{opcoes:cotacoes}});
        envio=dados;
        quitada=true;
        return rota.fulfill({json:{estado:"confirmado"}});
      }
      const arquivo=resolve(raiz,"."+url.pathname);
      if(!arquivo.startsWith(raiz+sep)) return rota.abort();
      try {return rota.fulfill({contentType:tipos[extname(arquivo)]??"application/octet-stream",body:await readFile(arquivo)});}
      catch {return rota.fulfill({status:404,body:""});}
    });
    await pagina.goto(origem+"/admin-loja.html?empresa_id="+empresa);
    await pagina.getByLabel("E-mail",{exact:true}).fill("gestor@example.invalid");
    await pagina.getByLabel("Senha",{exact:true}).fill("teste");
    await pagina.getByRole("button",{name:"Entrar"}).click();
    await pagina.getByText("Cartão de crédito — sandbox",{exact:true}).click();
    const seletor=pagina.getByLabel("Condições do cartão");
    await seletor.locator("option").filter({hasText:"6× de"}).waitFor({state:"attached"});
    assert.match(await seletor.innerText(),/1× de R\$\s*600,00/);
    await seletor.selectOption("1");
    assert.match(await seletor.innerText(),/6× de R\$\s*114,32/);
    const valores=await pagina.locator("[data-resumo-cartao]").innerText();
    assert.match(valores,/Acréscimo do parcelamento\s+R\$\s*85,92/);
    assert.match(valores,/Total a pagar\s+R\$\s*685,92/);
    assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth),viewport.width);
    if(process.env.LICENCA_CAPTURAS) {
      const nome=viewport.width>500?"CHECKOUT-DESKTOP.png":"CHECKOUT-MOBILE.png";
      await pagina.screenshot({path:resolve(process.env.LICENCA_CAPTURAS,nome),fullPage:true,animations:"disabled"});
    }
    await pagina.getByLabel("Nome do titular de teste").fill("Titular de teste");
    await pagina.getByLabel("CPF de teste").fill("12345678900");
    await pagina.getByLabel(/Aceito os termos v2 e as condições/).check();
    await pagina.getByRole("button",{name:"Pagar com cartão de teste"}).click();
    await pagina.getByText(/R\$.*600,00.*Confirmado/).waitFor();
    assert.deepEqual(envio.condicoes,cotacoes[1]);
    assert.equal(envio.empresa,empresa);
    assert.equal(envio.token,"token-de-teste-sem-cartao");
    assert.ok(!Object.hasOwn(envio,"numero") && !Object.hasOwn(envio,"documento"));
    await pagina.close();
  }
});
