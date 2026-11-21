import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {readFile,readdir} from "node:fs/promises";
import {extname,resolve,sep} from "node:path";
import {before,after,test} from "node:test";
import fotoHandler from "../api/foto-cardapio.mjs";

const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db=new PGlite();
const root=resolve(import.meta.dirname,"..");
const empresa=n=>"80000000-0000-0000-0000-"+String(n).padStart(12,"0");
const id=n=>"81000000-0000-0000-0000-"+String(n).padStart(12,"0");
const mesa=id(70), usuario=id(80), produto=id(90);
const snapshot=[{nome:"Lanche teste",quantidade:2,preco_centavos:500,produto_id:produto,observacao:"privada"}];

before(async()=>{
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon,authenticated,service_role;
  `);
  for(const arquivo of (await readdir(resolve(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")).sort()){
    await db.exec(await readFile(resolve(root,"supabase/migrations",arquivo),"utf8"));
  }
  await db.query("insert into empresas(id,nome,cardapio_slug) values($1,'Bistrô Teste','bistro-teste'),($2,'Outra loja','outra-loja'),($3,'Vazia','sem-pedidos')",
    [empresa(1),empresa(2),empresa(3)]);
  await db.query("insert into auth.users values($1,'cozinha@example.invalid')",[usuario]);
  await db.query("insert into equipe_kds(empresa_id,usuario_id) values($1,$2)",[empresa(1),usuario]);
  await db.query("insert into mesas_cardapio(empresa_id,numero,token) values($1,7,$2)",[empresa(1),mesa]);
  await db.query("insert into produtos(id,empresa_id,codigo,nome,preco_centavos) values($1,$2,'L','Lanche teste',500)",[produto,empresa(1)]);
  for(const [n,loja,m,estado,sandbox,data] of [
    [1,1,7,"pronto",false,"2026-11-20T11:00:00Z"],[2,1,8,"pronto",false,"2026-11-20T10:00:00Z"],
    [3,1,null,"pronto",false,"2026-11-20T09:00:00Z"],[4,1,7,"entregue",false,"2026-11-20T10:00:00Z"],
    [5,1,7,"preparo",false,"2026-11-20T10:00:00Z"],[6,1,7,"pronto",true,"2026-11-20T10:00:00Z"],
    [7,2,12,"pronto",false,"2026-11-20T10:00:00Z"]
  ]){
    await db.query(`insert into pedidos_online(id,empresa_id,cliente,mesa,estado,pix_sandbox_solicitado,criado_em,itens,total_centavos)
      values($1,$2,'Cliente privado',$3,$4,$5,$6,$7,1000)`,[id(n),empresa(loja),m,estado,sandbox,data,JSON.stringify(snapshot)]);
  }
});
after(()=>db.close());

async function como(role,sql,params=[]){
  return db.transaction(async tx=>{
    await tx.exec("set local role "+role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [role==="authenticated"?usuario:"",role]);
    return tx.query(sql,params);
  });
}
const fila=async slug=>(await como("anon","select pedidos_prontos_retirada($1) fila",[slug])).rows[0].fila;

test("RPC pública mostra só mesa pronta, em FIFO, com campos mínimos e isolamento",async()=>{
  const pedidos=await fila("bistro-teste");
  assert.deepEqual(pedidos.map(p=>p.mesa),[8,7]);
  for(const p of pedidos){
    assert.deepEqual(Object.keys(p).sort(),["comanda","criado_em","estado","itens","mesa"]);
    assert.deepEqual(p.itens,[{nome:"Lanche teste",quantidade:2}]);
    assert.equal(p.estado,"pronto");
  }
  assert.deepEqual((await fila("outra-loja")).map(p=>p.mesa),[12]);
  assert.deepEqual(await fila("sem-pedidos"),[]);
  assert.equal(await fila("desconhecida"),null);
});

test("manifesto de Retirada e Cardápio conserva a identidade da loja",async()=>{
  const resposta=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},
    send(s){this.data=JSON.parse(s);},end(){}});
  for(const [modo,caminho] of [["retirada","retirada"],["1","cardapio"]]){
    const res=resposta();
    await fotoHandler({method:"GET",query:{loja:"bistro-teste",manifesto:modo}},res);
    assert.equal(res.code,200);
    assert.equal(res.data.id,"/"+caminho+".html?loja=bistro-teste");
    assert.equal(res.data.start_url,res.data.id);
    assert.equal(res.data.scope,"/"+caminho+".html");
    assert.equal(res.data.display,"standalone");
    assert.match(res.headers["Content-Type"],/^application\/manifest\+json/);
  }
  const invalido=resposta();
  await fotoHandler({method:"GET",query:{loja:"!",manifesto:"retirada"}},invalido);
  assert.equal(invalido.code,400);
});

const rpcs={
  ver_cardapio:["p_slug"],enviar_pedido:["p_slug","p_id","p_cliente","p_mesa","p_itens"],
  acompanhar_pedido:["p_slug","p_id"],lojas_kds:[],fila_cozinha:["p_empresa"],pode_editar_comanda_kds:["p_empresa"],
  cancelamentos_recentes_kds:["p_empresa"],avancar_pedido:["p_id","p_estado"],pedidos_prontos_retirada:["p_slug"]
};
const mime={".html":"text/html",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".png":"image/png"};
test("Chrome: envia na mesa, KDS marca pronto, toca uma vez, fila publica e QR retoma",{
  skip:!process.env.PAINEL_PLAYWRIGHT_MODULE||!process.env.PAINEL_CHROME_PATH
},async()=>{
  const servidor=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,"http://localhost");
      if(url.pathname==="/api/foto-cardapio"){
        const r={setHeader:(...p)=>res.setHeader(...p),status(s){res.statusCode=s;return this;},send:s=>res.end(s),end:()=>res.end()};
        return await fotoHandler({method:req.method,query:Object.fromEntries(url.searchParams)},r);
      }
      const file=resolve(root,"."+url.pathname);
      if(!file.startsWith(root+sep))return res.writeHead(403).end();
      const dados=await readFile(file);res.writeHead(200,{"Content-Type":mime[extname(file)]??"application/octet-stream"}).end(dados);
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  const {chromium}=require(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.PAINEL_CHROME_PATH});
  let pedidoNovo;
  const erros=[];
  try{
    await new Promise(r=>servidor.listen(0,"127.0.0.1",r));
    const base="http://127.0.0.1:"+servidor.address().port;
    const ctx=await browser.newContext({viewport:{width:1280,height:800}});
    await ctx.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==="/auth/v1/token")return route.fulfill({json:{user:{id:usuario},access_token:"fixture",expires_in:3600}});
      const nome=path.split("/").at(-1), campos=rpcs[nome];
      const args=route.request().postDataJSON();
      try{
        assert.ok(campos,"RPC inesperada: "+nome);
        const params=campos.map(k=>Array.isArray(args[k])?JSON.stringify(args[k]):args[k]);
        const role=route.request().headers().authorization?"authenticated":"anon";
        const chamada=nome+"("+campos.map((_,i)=>"$"+(i+1)).join(",")+")";
        const sql=nome==="lojas_kds" ? "select coalesce(jsonb_agg(t),'[]') dados from "+chamada+" t" : "select "+chamada+" dados";
        const {rows}=await como(role,sql,params);
        if(nome==="enviar_pedido")pedidoNovo=rows[0].dados;
        if(nome==="avancar_pedido")return route.fulfill({status:204});
        return route.fulfill({json:rows[0].dados});
      }catch(e){erros.push(e.code??e.message);return route.fulfill({status:500,json:{erro:"Falha de fixture"}});}
    });
    const cliente=await ctx.newPage(),kds=await ctx.newPage(),retirada=await ctx.newPage();
    for(const pagina of [cliente,kds,retirada]){pagina.on("pageerror",e=>erros.push(e.message));pagina.setDefaultTimeout(20000);}
    await cliente.addInitScript(()=>{
      window.auditoriaAlertas={sons:0,permissoes:0,notificacoes:0};
      window.AudioContext=class{
        state="running";
        currentTime=0;
        destination={};
        createGain(){return {connect(){return this;},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}};}
        createOscillator(){return {frequency:{},connect(){return this;},start(){window.auditoriaAlertas.sons++;},stop(){}};}
      };
      window.Notification=class{
        static permission="default";
        static async requestPermission(){window.auditoriaAlertas.permissoes++;this.permission="denied";return "denied";}
        constructor(){window.auditoriaAlertas.notificacoes++;}
      };
    });
    const qr=base+"/cardapio.html?loja=bistro-teste&mesa="+mesa;
    await cliente.goto(qr);
    await cliente.locator('[aria-label*="Adicionar"]').first().click();
    await cliente.locator("#ver-pedido").click();
    await cliente.locator("#cliente").fill("Cliente confidencial do ensaio");
    await cliente.locator("#enviar-pedido").click();
    await cliente.getByText(/Mantenha esta tela aberta/).waitFor();
    assert.ok(pedidoNovo);
    const comanda=(await db.query("select comanda from pedidos_online where id=$1",[pedidoNovo])).rows[0].comanda;
    await kds.goto(base+"/kds.html");
    await kds.locator("#email-kds").fill("cozinha@example.invalid");
    await kds.locator("#senha-kds").fill("fixture");
    await kds.getByRole("button",{name:"Entrar na cozinha"}).click();
    const card=kds.locator("#fila-cozinha article").filter({hasText:"Cliente confidencial do ensaio"});
    await card.getByRole("button",{name:"Iniciar preparo"}).click();
    await card.getByRole("button",{name:"Marcar pronto"}).waitFor();
    await cliente.bringToFront();
    await cliente.waitForFunction(()=>document.querySelector("#mensagem").textContent.startsWith("Em preparo"));
    await kds.bringToFront();
    await card.getByRole("button",{name:"Marcar pronto"}).click();
    await card.getByRole("button",{name:"Marcar entregue"}).waitFor();
    await cliente.bringToFront();
    const pronto=cliente.locator("#pedido-pronto");
    await pronto.getByText("Comanda "+comanda+" · Mesa 7",{exact:true}).waitFor();
    const guardar=(p,n)=>process.env.PAINEL_CAPTURAS&&p.screenshot({path:resolve(process.env.PAINEL_CAPTURAS,n+".png"),animations:"disabled"});
    await guardar(cliente,"cliente-pronto");
    await cliente.waitForFunction(()=>window.auditoriaAlertas.sons===1);
    const reler=cliente.waitForResponse(r=>r.url().endsWith("/acompanhar_pedido"));
    await reler;
    assert.deepEqual(await cliente.evaluate(()=>window.auditoriaAlertas),{sons:1,permissoes:1,notificacoes:0});
    await retirada.goto(base+"/retirada.html?loja=bistro-teste");
    await retirada.getByRole("heading",{name:"Comanda "+comanda,exact:true}).waitFor();
    assert.doesNotMatch(await retirada.locator("main").innerText(),/Cliente confidencial|R\$/);
    await retirada.waitForFunction(async()=>Boolean(await navigator.serviceWorker.getRegistration()));
    const href=await retirada.locator('link[rel="manifest"]').getAttribute("href");
    const manifest=await (await retirada.request.get(base+href)).json();
    assert.equal(manifest.start_url,"/retirada.html?loja=bistro-teste");
    await guardar(retirada,"retirada-desktop");
    await retirada.setViewportSize({width:390,height:844});
    await guardar(retirada,"retirada-mobile");
    const volta=await ctx.newPage();
    await volta.goto(qr);
    await volta.locator("#pedido-pronto").getByText("Comanda "+comanda+" · Mesa 7",{exact:true}).waitFor();
    assert.equal(new URL(volta.url()).searchParams.get("pedido"),pedidoNovo);
    await volta.close();
    await card.getByRole("button",{name:"Marcar entregue"}).click();
    await cliente.bringToFront();
    await pronto.waitFor({state:"hidden"});
    assert.deepEqual(await cliente.evaluate(()=>window.auditoriaAlertas),{sons:1,permissoes:1,notificacoes:0});
    await retirada.bringToFront();
    await retirada.getByRole("heading",{name:"Comanda "+comanda,exact:true}).waitFor({state:"detached"});
    assert.ok(!(await fila("bistro-teste")).some(p=>String(p.comanda)===String(comanda)));
    assert.deepEqual(erros,[]);
  }finally{await browser.close();servidor.close();}
});
