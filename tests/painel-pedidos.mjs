import assert from "node:assert/strict";
import { readFile,readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname,resolve,sep } from "node:path";
import { before,after,test } from "node:test";
import handler from "../api/cadastrar-operador.mjs";

const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.PAINEL_PGLITE_MODULE||"@electric-sql/pglite");
const db=new PGlite();
const root=resolve(import.meta.dirname,"..");
const read=p=>readFile(resolve(root,p),"utf8");
const config=JSON.parse(await read("vercel.json"));
const a="30000000-0000-0000-0000-00000000000a";
const b="30000000-0000-0000-0000-00000000000b";
const ids={a:"40000000-0000-0000-0000-000000000001",b:"40000000-0000-0000-0000-000000000002",
  op:"40000000-0000-0000-0000-000000000003"};
const pedido = i => "50000000-0000-0000-0000-" + String(i).padStart(12,"0");
const produto = pedido(97);
const snapshot = [{produto_id:produto,nome:"Produto histórico",quantidade:2,preco_centavos:500}];
before(async()=>{
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon,authenticated,service_role;
  `);
  for(const n of (await readdir(resolve(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")).sort())
    await db.exec(await read("supabase/migrations/"+n));
  for(const [label,id] of Object.entries(ids))await db.query("insert into auth.users values($1,$2)",[id,label+"@example.invalid"]);
  await db.query("insert into empresas(id,nome,cardapio_slug) values($1,'Loja A','a'),($2,'Loja B','b')",[a,b]);
  await db.query("insert into membros values($1,$3,'gestor'),($2,$4,'gestor'),($1,$5,'operador')",[a,b,ids.a,ids.b,ids.op]);
  await db.query("insert into produtos(id,empresa_id,codigo,nome,preco_centavos) values($1,$2,'P','Produto da vitrine',500)",[produto,a]);
  await db.query(`insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,criado_em,estado)
    select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      case when n=28 then $2::uuid else $1::uuid end,'Cliente '||n,$3,case when n=27 then 1300 else 1000 end,
      case when n=1 then '2026-11-18'::timestamptz else '2026-11-19'::timestamptz end,
      case when n=27 then 'pronto' else 'novo' end
    from generate_series(1,28) n`,[a,b,JSON.stringify(snapshot)]);
  await db.query(`insert into entregas_pedido values
    ($1,'{"logradouro":"Rua de teste","telefone":"11922223333","segredo":"interno"}','na_entrega',300)`,[pedido(27)]);
  await db.query(`insert into remo.solicitacoes(origem,ambiente,referencia,solicitante,destino,estado,ordem_remo,cobrar_na_entrega_centavos)
    values('r_sistemas','producao',$1,$2,'{}','entregue',$3,1300)`,[pedido(27),a,pedido(99)]);
  await db.query(`insert into remo.solicitacoes(id,origem,ambiente,referencia,solicitante,destino,estado,criada_em,cobrar_na_entrega_centavos)
    select ('51000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'r_sistemas',
      case when n=1 then 'sandbox' else 'producao' end,
      ('50000000-0000-0000-0000-'||lpad(n::text,12,'0')),case when n=28 then $2::uuid else $1::uuid end,
      '{"logradouro":"Endereço REMO","telefone":"11900000000","segredo":"privado"}',
      'aceita','2026-11-19 16:00:00+00'::timestamptz,0
    from generate_series(1,28) n where n<>27`,[a,b]);
  await db.query(`update remo.solicitacoes set id='51000000-0000-0000-0000-000000000027',criada_em='2026-11-20 01:30:00+00'
    where referencia=$1 and solicitante=$2`,[pedido(27),a]);
  await db.query(`insert into cancelamentos_comanda(id,pedido_id,solicitado_por,motivo,estado,etapa_pedido)
    values($3,$1,$2,'Teste','cancelado','novo')`,[pedido(2),ids.a,pedido(98)]);
  await db.query("insert into caixas(id,empresa_id,operador_id,abertura_centavos) values($1,$2,$3,0)",[pedido(96),a,ids.op]);
  await db.query(`insert into vendas(id,caixa_id,empresa_id,total_centavos,meio,desconto_centavos)
    values($1,$2,$3,950,'cartao',50),($4,$2,$3,1000,'dinheiro',0)`,[pedido(1),pedido(96),a,pedido(95)]);
});
after(()=>db.close());

async function como(token,sql,params=[],role=ids[token]?"authenticated":"anon") {
  return db.transaction(async tx=>{
    await tx.exec("set local role "+role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [ids[token]??"",role]);
    return tx.query(sql,params);
  });
}

const lista = (token,empresa,params=[]) => como(token,
  "select painel_listar_pedidos($1,$2,$3,$4,$5,$6,$7,$8) dados",
  [empresa,...Array.from({length:7},(_,i)=>params[i]??(i===6?25:null))]).then(r=>r.rows[0].dados);
const detalhe = (token,empresa,id) => como(token,"select painel_detalhe_pedido($1,$2) dados",
  [empresa,id]).then(r=>r.rows[0].dados);
const rota = (empresa,pedido) => "/api/painel-pedidos?"+new URLSearchParams({
  empresa_id:empresa,...(pedido&&{pedido_id:pedido})
});

test("cursor estável com empate de timestamp e filtros combinados",async()=>{
  const vistos=[];
  let cursor=null;
  do{
    const r=await lista("a",a,[null,null,null,null,cursor?.data,cursor?.id,5]);
    vistos.push(...r.pedidos.map(x=>x.id));cursor=r.proximo_cursor;
  }while(cursor);
  assert.deepEqual(vistos,Array.from({length:27},(_,i)=>pedido(27-i)));
  const r=await lista("a",a,["2026-11-19","2026-11-20","pronto","entrega"]);
  assert.deepEqual(r.pedidos.map(x=>x.id),[pedido(27)]);
  assert.equal(r.pedidos[0].estado_kds,"pronto");
  assert.equal(r.pedidos[0].estado_entrega,"entregue");
  assert.deepEqual((await lista("a",a,[null,"2026-11-19"])).pedidos.map(x=>x.id),[pedido(1)]);
  assert.deepEqual((await lista("a",a,[null,null,"cancelado"])).pedidos.map(x=>x.id),[pedido(2)]);
  for(const f of [["2026-11-20","2026-11-19"],[null,null,"desconhecido"],[null,null,null,"pdv"],
    [null,null,null,null,"2026-11-19"],[null,null,null,null,null,null,51]]){
    await assert.rejects(lista("a",a,f),{code:"22023"});
  }
});

test("PII somente no detalhe da própria loja e snapshot de preço preservado",async()=>{
  const r=await lista("a",a);
  assert.doesNotMatch(JSON.stringify(r),/endereco|telefone|11922223333|Rua de teste/);
  await db.query("update produtos set preco_centavos=9999 where id=$1",[produto]);
  const p=await detalhe("a",a,pedido(27));
  assert.deepEqual(p.itens,snapshot);
  assert.deepEqual(p.endereco,{logradouro:"Rua de teste",telefone:"11922223333"});
  assert.equal(p.total_centavos,1300);
  assert.equal(p.mercadoria_centavos,1000);
  assert.equal(p.frete_centavos,300);
  assert.equal(p.ordem_remo,pedido(99));
  const venda=await detalhe("a",a,pedido(1));
  assert.deepEqual([venda.total_centavos,venda.desconto_centavos,venda.pagamento_estado,venda.pagamento_meio],
    [950,50,"confirmado","cartao"]);
  await assert.rejects(detalhe("a",a,pedido(95)),{code:"PT404"});
  for(const [token,empresa,id] of [["a",b,pedido(28)],["b",a,pedido(27)],["op",a,pedido(27)],[null,a,pedido(27)]]){
    await assert.rejects(lista(token,empresa),{code:"42501"});
    await assert.rejects(detalhe(token,empresa,id),{code:"42501"});
  }
  await assert.rejects(detalhe("b",b,pedido(27)),{code:"PT404"});
  await assert.rejects(como("a","select * from painel_privado.pedidos_leitura"),{code:"42501"});
});


const remoid = n => "51000000-0000-0000-0000-"+String(n).padStart(12,"0");
const entregas = (token,empresa,acao="listar",dados={}) => como(token,
  "select painel_entregas($1,$2,$3) dados",[empresa,acao,JSON.stringify(dados)]).then(r=>r.rows[0].dados);

test("Entregas pagina por tempo e UUID, recorta São Paulo e exclui sandbox",async()=>{
  const vistos=[];
  let cursor;
  do{
    const pagina=await entregas("a",a,"listar",{limite:5,...(cursor&&{cursor_data:cursor.data,cursor_id:cursor.id})});
    assert.doesNotMatch(JSON.stringify(pagina),/destino|endereco|telefone|Endereço REMO|11900000000/);
    vistos.push(...pagina.entregas.map(x=>x.id));
    cursor=pagina.proximo_cursor;
  }while(cursor);
  assert.deepEqual(vistos,Array.from({length:26},(_,i)=>remoid(27-i)));
  const faixa={inicio:"2026-11-19T03:00:00Z",fim:"2026-11-20T03:00:00Z",estado:"entregue",busca:pedido(27)};
  assert.deepEqual((await entregas("a",a,"listar",faixa)).entregas.map(e=>e.id),[remoid(27)]);
  assert.equal((await entregas("a",a,"listar",{...faixa,inicio:"2026-11-20T00:00:00-03:00",fim:"2026-11-21T00:00:00-03:00"})).entregas.length,0);
  assert.deepEqual((await entregas("b",b)).entregas.map(e=>e.id),[remoid(28)]);
  const [{comanda}]=(await db.query("select comanda from public.pedidos_online where id=$1",[pedido(27)])).rows;
  assert.deepEqual((await entregas("a",a,"listar",{busca:String(comanda)})).entregas.map(e=>e.id),[remoid(27)]);
  for(const f of [{limite:51},{estado:"inexistente"},{cursor_id:remoid(22)}])await assert.rejects(entregas("a",a,"listar",f),{code:"22023"});
  await assert.rejects(entregas("a",a,"despachar"),{code:"22023"});
});

test("Entregas restringe detalhe, endereço e snapshots ao gestor da loja",async()=>{
  for(const [token,empresa] of [["a",b],["b",a],["op",a],[null,a]]){
    await assert.rejects(entregas(token,empresa),{code:"42501"});
    await assert.rejects(entregas(token,empresa,"detalhe",{id:remoid(27)}),{code:"42501"});
  }
  await assert.rejects(entregas("b",b,"detalhe",{id:remoid(27)}),{code:"PT404"});
  await assert.rejects(entregas("a",a,"detalhe",{id:remoid(1)}),{code:"PT404"});
  const d=await entregas("a",a,"detalhe",{id:remoid(27)});
  assert.deepEqual(d.destino,{logradouro:"Rua de teste",telefone:"11922223333"});
  assert.deepEqual(d.itens,snapshot);
  assert.deepEqual((await entregas("a",a,"detalhe",{id:remoid(26)})).destino,{logradouro:"Endereço REMO",telefone:"11900000000"});
});

test("Entregas mantém status da Function e do rewrite e aceita somente GET",async t=>{
  simular(t);
  for(const path of ["/api/painel-entregas?","/api/cadastrar-operador?painel_entregas=1&"]){
    const rota=empresa=>path+"empresa_id="+empresa;
    for (const [token,empresa,status] of [["a",a,200],["a",b,403],["b",a,403],["op",a,403],[null,a,401],["ruim",a,401]]){
      assert.equal((await api(rota(empresa),token)).code,status);
    }
    assert.equal((await api(rota(a),"a","POST")).code,405);
    assert.equal((await api(rota(a)+"&entrega_id="+remoid(28),"a")).code,404);
    assert.equal((await api(rota(a)+"&entrega_id="+remoid(27),"a")).body.destino.logradouro,"Rua de teste");
  }
});

function simular(t){
  process.env.SUPABASE_URL="https://banco.example";
  process.env.SUPABASE_ANON_KEY="fixture";
  t.mock.method(globalThis,"fetch",async(u,init)=>{
    const token=init.headers.Authorization?.replace("Bearer ","");
    if(!Object.hasOwn(ids,token))return new Response(null,{status:401});
    if(new URL(u).pathname==="/auth/v1/user")return Response.json({id:ids[token]});
    const p=JSON.parse(init.body);
    try{
      const rpc=new URL(u).pathname.split("/").at(-1);
      if(rpc==="painel_contexto_sessao")return Response.json((await como(token,"select painel_contexto_sessao($1) dados",[p.p_empresa_id])).rows[0].dados);
      if(rpc==="painel_listar_produtos")return Response.json({produtos:[]});
      if(rpc==="painel_entregas")return Response.json(await entregas(token,p.p_empresa,p.p_acao,p.p_dados));
      if(rpc==="painel_detalhe_pedido")return Response.json(await detalhe(token,p.p_empresa,p.p_pedido));
      return Response.json(await lista(token,p.p_empresa,[p.p_inicio,p.p_fim,p.p_estado,p.p_origem,p.p_cursor_data,p.p_cursor_id,p.p_limite]));
    }catch(e){
      const status={42501:403,22023:400,PT404:404}[e.code];
      if(!status)throw e;
      return new Response(null,{status});
    }
  });
}

async function api(path,token,method="GET"){
  const url=new URL(path,"http://localhost");
  const rewrite=config.rewrites.find(r=>r.source===url.pathname);
  const query=Object.fromEntries(url.searchParams);
  if(rewrite)Object.assign(query,Object.fromEntries(new URL(rewrite.destination,url).searchParams));
  const ret={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(d){this.body=d;},end(){}};
  await handler({query,method,headers:token?{authorization:"Bearer "+token}:{}},ret);
  assert.equal(ret.headers["Cache-Control"],"no-store");
  return ret;
}

test("rewrite e Function mantêm autorização, privacidade e método somente leitura",async t=>{
  simular(t);
  for(const layer of [x=>x,x=>x.replace("/api/painel-pedidos?","/api/cadastrar-operador?painel_pedidos=1&")]){
    for(const [user,empresa,id,expected] of [["a",a,null,200],["a",a,pedido(27),200],["b",b,null,200],
      ["a",b,null,403],["b",a,pedido(27),403],["b",b,pedido(27),404],
      ["op",a,null,403],["op",a,pedido(27),403],[null,a,null,401],["ruim",a,null,401]]){
      const r=await api(layer(rota(empresa,id)),user);
      assert.equal(r.code,expected);
      if(!id||expected!==200)assert.doesNotMatch(JSON.stringify(r.body),/telefone|Rua de teste/);
    }
    assert.equal((await api(layer(rota(a)+"&limite=0"),"a")).code,400);
    assert.equal((await api(layer(rota(a)),"a","POST")).code,405);
  }
});

test("Chrome abre filtros, paginação e detalhe pela entrada do painel",{
  skip:!process.env.PAINEL_PLAYWRIGHT_MODULE||!process.env.PAINEL_CHROME_PATH
},async t=>{
  simular(t);
  const {chromium}=require(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const navegador=await chromium.launch({headless:true,executablePath:process.env.PAINEL_CHROME_PATH,
    args:["--disable-background-networking","--disable-component-update"]});
  const tipos={".html":"text/html",".mjs":"text/javascript",".css":"text/css"};
  const servidor=createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,"http://localhost");
      if(u.pathname.startsWith("/api/")){
        const r=await api(req.url,req.headers.authorization?.split(" ")[1]);
        res.writeHead(r.code,{"Content-Type":"application/json",...r.headers});
        return res.end(JSON.stringify(r.body));
      }
      const f=resolve(root,"."+u.pathname);
      if(!f.startsWith(root+sep))return res.writeHead(403).end();
      const dados=await readFile(f);
      res.writeHead(200,{"Content-Type":tipos[extname(f)]??"text/plain"});
      res.end(dados);
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  try{
    await new Promise(resolve=>servidor.listen(0,"127.0.0.1",resolve));
    const pagina=await navegador.newPage(), base="http://127.0.0.1:"+servidor.address().port;
    await pagina.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",route=>{
      const u=new URL(route.request().url());
      if(u.pathname==="/auth/v1/token")return route.fulfill({json:{user:{id:ids.a},access_token:"a",refresh_token:"fixture",expires_in:3600}});
      if(u.pathname==="/rest/v1/membros")return route.fulfill({json:[{empresas:{id:a,nome:"Loja A"}}]});
      return route.abort();
    });
    await pagina.goto(base+"/admin-loja.html");
    await pagina.getByLabel("E-mail",{exact:true}).fill("a@example.invalid");
    await pagina.getByLabel("Senha",{exact:true}).fill("fixture");
    await pagina.getByRole("button",{name:"Entrar",exact:true}).click();
    await pagina.getByText("Página 1",{exact:true}).waitFor();
    await pagina.getByRole("button",{name:"Pedidos",exact:true}).click();
    const area=pagina.locator("#area-pedidos");
    const status=area.getByRole("status");
    await status.getByText("Página 1",{exact:true}).waitFor();
    await area.getByRole("button",{name:"Próxima",exact:true}).click();
    await status.getByText("Página 2",{exact:true}).waitFor();
    await area.getByRole("button",{name:"Anterior",exact:true}).click();
    await status.getByText("Página 1",{exact:true}).waitFor();
    await area.getByLabel("Estado",{exact:true}).selectOption("pronto");
    await area.getByLabel("Origem",{exact:true}).selectOption("entrega");
    await area.getByLabel("De",{exact:true}).fill("2026-11-18");
    await area.getByLabel("Até",{exact:true}).fill("2026-11-20");
    const resposta=pagina.waitForResponse(r=>r.url().includes("/api/painel-pedidos?")&&r.url().includes("estado=pronto"));
    await area.getByRole("button",{name:"Aplicar filtros"}).click();
    assert.equal((await resposta).status(),200);
    await area.locator("tbody tr").first().waitFor();
    assert.equal(await area.locator("tbody tr").count(),1);
    await area.getByLabel(/Buscar cliente/).fill("inexistente");
    await status.getByText(/Nenhum pedido/).waitFor();
    await area.getByLabel(/Buscar cliente/).fill("Cliente 27");
    assert.equal(await area.locator("tbody").getByText(/Rua de teste|11922223333/).count(),0);
    await area.locator("tbody button").click();
    const dialogo=area.getByRole("dialog");
    await dialogo.getByText("Rua de teste",{exact:true}).waitFor();
    await dialogo.getByText("11922223333",{exact:true}).waitFor();
    await dialogo.getByText(/Produto histórico.*5,00/).waitFor();
    await dialogo.getByRole("button",{name:"Fechar"}).click();
    assert.equal(await area.locator("[data-pedido-dados]").textContent(),"");
    await area.locator("tbody button").click();
    await dialogo.waitFor();
    await pagina.keyboard.press("Escape");
    assert.equal(await area.locator("[data-pedido-dados]").textContent(),"");

    const nav=pagina.locator("#lateral-painel nav button");
    assert.deepEqual(await nav.evaluateAll(ns=>ns.map(n=>n.id)),["aba-visao","aba-pedidos","aba-entregas","aba-financeiro","aba-catalogo","aba-mesas","aba-equipe","aba-preferencias"]);
    await pagina.getByRole("button",{name:"Entregas",exact:true}).click();
    const areaEnt=pagina.locator("#area-entregas"), statusEnt=areaEnt.getByRole("status");
    await statusEnt.getByText("Página 1",{exact:true}).waitFor();
    await areaEnt.getByRole("button",{name:"Próxima",exact:true}).click();
    await statusEnt.getByText("Página 2",{exact:true}).waitFor();
    await areaEnt.getByRole("button",{name:"Anterior",exact:true}).click();
    await statusEnt.getByText("Página 1",{exact:true}).waitFor();
    await areaEnt.locator('select[name="estado"]').selectOption("entregue");
    await areaEnt.getByLabel("De",{exact:true}).fill("2026-11-19");
    await areaEnt.getByLabel("Até",{exact:true}).fill("2026-11-19");
    await areaEnt.getByLabel("Comanda ou ID do pedido").fill(pedido(27));
    const respostaEnt=pagina.waitForResponse(r=>r.url().includes("/api/painel-entregas?")&&r.url().includes("estado=entregue"));
    await areaEnt.getByRole("button",{name:"Aplicar filtros"}).click();
    const req=await respostaEnt;
    assert.equal(req.status(),200);
    assert.equal(new URL(req.url()).searchParams.get("fim"),"2026-11-20T03:00:00.000Z");
    await areaEnt.locator("tbody tr").first().waitFor();
    assert.equal(await areaEnt.locator("tbody tr").count(),1);
    assert.doesNotMatch(await areaEnt.locator("tbody").innerText(),/Rua de teste|11922223333/);
    const captura=process.env.PAINEL_CAPTURAS;
    const guardar=nome=>captura&&pagina.screenshot({path:resolve(captura,nome+".png"),animations:"disabled"});
    await guardar("entregas-desktop");
    await areaEnt.locator("tbody button").click();
    const drawer=areaEnt.getByRole("dialog");
    await drawer.getByText("Rua de teste",{exact:true}).waitFor();
    await drawer.getByText("11922223333",{exact:true}).waitFor();
    await drawer.getByText(/Produto histórico/).waitFor();
    await guardar("entregas-detalhe-desktop");
    await pagina.keyboard.press("Escape");
    assert.equal(await areaEnt.locator("dialog dl").textContent(),"");
    await pagina.setViewportSize({width:390,height:844});
    await pagina.getByRole("button",{name:"Abrir menu"}).click();
    assert.equal(await pagina.getByRole("button",{name:"Entregas",exact:true}).isVisible(),true);
    await guardar("entregas-sidebar-mobile");
    await pagina.getByRole("button",{name:"Entregas",exact:true}).click();
    await statusEnt.getByText("Página 1",{exact:true}).waitFor();
    await guardar("entregas-mobile");
    await areaEnt.locator("tbody button").first().click();
    await drawer.getByText("Rua de teste",{exact:true}).waitFor();
    await guardar("entregas-detalhe-mobile");
  }finally{servidor.close();await navegador.close();}
});
