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
  await db.query("insert into produtos(empresa_id,codigo,nome,preco_centavos) values($1,'P','Produto da vitrine',900)",[a]);
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
const prefs=(token,empresa,dados=null)=>como(token,"select painel_preferencias($1,$2) as dados",
  [empresa,dados===null?null:JSON.stringify(dados)]);
const publicacao=async slug=>(await como(null,"select ver_cardapio($1) as menu",[slug])).rows[0].menu;
const aceita=async slug=>(await como(null,"select pagamento_na_entrega_disponivel($1) as aceita",[slug])).rows[0].aceita;
const auditoria=async()=> (await db.query(`select * from painel_privado.auditoria where acao='empresas.preferencias'
   order by ocorrido_em,id`)).rows;
const path=empresa=>"/api/painel-preferencias?empresa_id="+empresa;
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
      const {rows:[r]}=rpc==="painel_contexto_sessao"
        ? await como(token,"select painel_contexto_sessao($1) as dados",[p.p_empresa_id])
        : rpc==="painel_listar_produtos"
          ? await como(token,"select painel_listar_produtos($1,$2,$3) as dados",[p.p_empresa_id,p.p_cursor,p.p_limite])
          : await prefs(token,p.p_empresa,p.p_dados);
      return Response.json(r.dados);
    }catch(e){
      const status={42501:403,22023:400,23514:400,23502:400,22003:400}[e.code];
      if(!status)throw e;
      return new Response(null,{status});
    }
  });
}

async function api(path,token,body){
  const url=new URL(path,"http://localhost");
  const rewrite=config.rewrites.find(r=>r.source===url.pathname);
  const query=Object.fromEntries(url.searchParams);
  if(rewrite)Object.assign(query,Object.fromEntries(new URL(rewrite.destination,url).searchParams));
  const ret={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(d){this.body=d;},end(){}};
  await handler({query,method:body?"POST":"GET",body,headers:token?{authorization:"Bearer "+token}:{}},ret);
  assert.equal(ret.headers["Cache-Control"],"no-store");
  return ret;
}

test("API e RPC isolam os dois gestores, negam operador e exigem sessão",async t=>{
  simular(t);
  for(const token of [null,"inválido"])assert.equal((await api(path(a),token)).code,401);
  for(const [token,propria,alheia] of [["a",a,b],["b",b,a],["op",null,a]]){
    if(propria)assert.equal((await api(path(propria),token)).code,200);
    for(const dados of [null,{pagamento_na_entrega:true}]){
      assert.equal((await api(path(alheia),token,dados&&{dados})).code,403);
      await assert.rejects(prefs(token,alheia,dados),{code:"42501"});
    }
  }
  await assert.rejects(prefs(null,a),{code:"42501"});
});

test("formato é validado pela Function e pelo PostgreSQL",async t=>{
  simular(t);
  const bad=[
    [{cardapio_cor:"#xyz"},"23514"],[{cardapio_fundo:"#123456"},"23514"],
    [{cardapio_logo:"data:image/webp;base64,"+"A".repeat(44000)},"23514"],
    [{cardapio_agradecimento:"data:image/png;base64,AA"},"23514"],
    [{mapa_centro_latitude:90.0000001,mapa_centro_longitude:0},"22023"],
    [{mapa_centro_latitude:0,mapa_centro_longitude:181},"22023"],
    [{mapa_centro_latitude:null,mapa_centro_longitude:20},"22023"],
    [{pagamento_na_entrega:"true"},"22023"]
  ];
  for(const [dados,code] of bad){
    assert.equal((await api(path(a),"a",{dados})).code,400);
    await assert.rejects(prefs("a",a,dados),{code});
  }
  assert.equal((await auditoria()).length,0);
});

test("audita campos alterados sem imagem bruta, propaga à vitrine e ao checkout, e cobre o legado",async t=>{
  simular(t);
  const logo="data:image/webp;base64,QUJDREVGRw==";
  const dados={cardapio_cor:"#181848",cardapio_fundo:"#ffffff",cardapio_logo:logo,
    mapa_centro_latitude:-16.741234,mapa_centro_longitude:-48.5,pagamento_na_entrega:true};
  assert.equal(await aceita("a"),false);
  const r=await api(path(a),"a",{dados});
  assert.equal(r.code,200);
  assert.equal(r.body.metodos.debito,false);
  assert.equal((await publicacao("a")).cor,dados.cardapio_cor);
  assert.equal((await publicacao("a")).logo,logo);
  assert.deepEqual((await publicacao("a")).mapa_centro,{latitude:-16.741234,longitude:-48.5});
  assert.equal(await aceita("a"),true);
  const registros=await auditoria();
  assert.equal(registros.length,3);
  assert.ok(registros.every(r=>r.empresa_id===a&&r.autor_id===ids.a&&r.origem_autor==="usuario"));
  const visual=registros.find(r=>Object.hasOwn(r.depois,"cardapio_logo"));
  assert.deepEqual(visual.antes.cardapio_logo,{presente:false});
  assert.deepEqual(visual.depois.cardapio_logo,{presente:true});
  assert.equal(visual.depois.cardapio_agradecimento,undefined);
  assert.doesNotMatch(JSON.stringify(registros),/data:image/);
  await prefs("a",a,dados);
  assert.equal((await auditoria()).length,3);
  await como("a","select configurar_pagamento_na_entrega($1,false)",[a]);
  await como("a","select configurar_aparencia_cardapio($1,'#112233','#ffffff',$2,null)",[a,logo]);
  assert.equal(await aceita("a"),false);
  const legados=(await auditoria()).slice(3);
  assert.equal(legados.length,2);
  assert.deepEqual(legados.find(r=>Object.hasOwn(r.depois,"pagamento_na_entrega")).depois,{pagamento_na_entrega:false});
  assert.deepEqual(legados.find(r=>Object.hasOwn(r.depois,"cardapio_cor")).depois,{cardapio_cor:"#112233"});
  await db.query("update empresas set cardapio_fundo='#f8f4eb' where id=$1",[b]);
  assert.equal((await auditoria()).at(-1).origem_autor,"sistema");
  await db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
    await tx.query("update empresas set cardapio_fundo='#ffffff' where id=$1",[b]);
  });
  assert.equal((await auditoria()).at(-1).origem_autor,"servico");
});

test("falha injetada na última escrita reverte preferências e auditorias anteriores",async()=>{
  await db.exec(`
    create function public.fixture_preferencias() returns trigger language plpgsql as $$
      begin raise check_violation; end $$;
    create trigger fixture_pref before insert on painel_privado.auditoria for each row
    when (new.acao='empresas.preferencias' and new.depois->>'pagamento_na_entrega'='true')
    execute function public.fixture_preferencias();
  `);
  const antes=(await prefs("a",a)).rows[0].dados;
  const log=await auditoria();
  await assert.rejects(prefs("a",a,{cardapio_cor:"#336655",mapa_centro_latitude:null,mapa_centro_longitude:null,
    pagamento_na_entrega:true}),{code:"23514"});
  assert.deepEqual((await prefs("a",a)).rows[0].dados,antes);
  assert.equal((await auditoria()).length,log.length);
  await db.exec("drop trigger fixture_pref on painel_privado.auditoria");
});

test("Chrome sobrepõe rascunho à vitrine real do ensaio e abre o cardápio atualizado depois do save",{
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
        const chunks=[];
        for await(const chunk of req)chunks.push(chunk);
        const raw=Buffer.concat(chunks).toString();
        const r=await api(req.url,req.headers.authorization?.split(" ")[1],raw?JSON.parse(raw):undefined);
        res.writeHead(r.code,{"Content-Type":"application/json",...r.headers});return res.end(JSON.stringify(r.body));
      }
      const f=resolve(root,"."+u.pathname);
      if(!f.startsWith(root+sep))return res.writeHead(403).end();
      res.writeHead(200,{"Content-Type":tipos[extname(f)]??"text/plain"});res.end(await readFile(f));
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  try{
    await new Promise(resolve=>servidor.listen(0,"127.0.0.1",resolve));
    const pagina=await navegador.newPage(), base="http://127.0.0.1:"+servidor.address().port;
    await pagina.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async route=>{
      const u=new URL(route.request().url());
      if(u.pathname==="/auth/v1/token")return route.fulfill({json:{user:{id:ids.a},access_token:"a",refresh_token:"fixture",expires_in:3600}});
      if(u.pathname==="/rest/v1/membros")return route.fulfill({json:[{empresas:{id:a,nome:"Loja A"}}]});
      if(u.pathname.endsWith("/ver_cardapio"))return route.fulfill({json:await publicacao(route.request().postDataJSON().p_slug)});
      if(u.pathname.endsWith("/pagamento_na_entrega_disponivel"))return route.fulfill({json:await aceita("a")});
      return route.fulfill({json:false});
    });
    await pagina.goto(base+"/admin-loja.html");
    await pagina.getByLabel("E-mail",{exact:true}).fill("a@example.invalid");
    await pagina.getByLabel("Senha",{exact:true}).fill("fixture");
    await pagina.getByRole("button",{name:"Entrar",exact:true}).click();
    await pagina.getByRole("button",{name:"Preferências",exact:true}).click();
    const previa=pagina.getByRole("complementary",{name:"Prévia do cardápio"});
    await previa.getByText(/Produto da vitrine/).waitFor();
    await pagina.getByLabel("Cor principal").evaluate(input=>{
      input.value="#226655";input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    const png=await pagina.evaluate(async()=>{
      const canvas=document.createElement("canvas");canvas.width=2;canvas.height=2;
      canvas.getContext("2d").fillRect(0,0,2,2);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await pagina.getByLabel("Logo",{exact:true}).setInputFiles({name:"logo.png",mimeType:"image/png",buffer:Buffer.from(png)});
    await pagina.waitForFunction(()=>document.querySelector("[data-previa-logo]").naturalWidth===2);
    assert.match(await previa.locator("[data-previa-logo]").getAttribute("src"),/^data:image\/webp;base64,/);
    await pagina.getByLabel("Latitude").fill("-16.2");
    await pagina.getByLabel("Longitude").fill("-48.2");
    await pagina.getByLabel("Habilitar pagamento na entrega").check();
    assert.equal(await previa.evaluate(node=>node.style.getPropertyValue("--verde")),"#226655");
    assert.notEqual((await publicacao("a")).cor,"#226655");
    await pagina.getByRole("button",{name:"Salvar preferências"}).click();
    await pagina.getByText("Preferências salvas.",{exact:true}).waitFor();
    assert.equal(await aceita("a"),true);
    await pagina.goto(base+"/cardapio.html?loja=a");
    await pagina.locator("#loja").getByText("Loja A",{exact:true}).waitFor();
    assert.equal(await pagina.locator("html").evaluate(e=>e.style.getPropertyValue("--verde")),"#226655");
  }finally{servidor.close();await navegador.close();}
});
