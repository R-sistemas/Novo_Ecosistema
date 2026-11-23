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

const uid=n=>"60000000-0000-0000-0000-"+String(n).padStart(12,"0");
const itens=loja=>JSON.stringify([{produto_id:uid(loja),quantidade:1}]);
const sigs={
  "public.enviar_pedido(text,uuid,text,uuid,jsonb)":"6544732ce958ce76982ecadd2fb8b23d",
  "public.comandas_pendentes(uuid,text)":"e7ac5b4aa92617303fbf09785dfcac21",
  "public.configurar_mesa_cardapio(uuid,integer)":"b30bef3febaeeded21027485daa88def"
};
const contratos=async()=>Object.fromEntries(await Promise.all(Object.keys(sigs).map(async sig=>{
  const {rows:[r]}=await db.query("select oid,proacl::text acl,md5(replace(prosrc,chr(13)||chr(10),chr(10))) corpo from pg_proc where oid=$1::regprocedure",[sig]);
  return [sig,r];
})));
before(async()=>{
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,invited_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon,authenticated,service_role;
  `);
  const migrations=(await readdir(resolve(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")).sort();
  for(const n of migrations.filter(n=>n<"202611200060"))await db.exec(await read("supabase/migrations/"+n));
  for(const [label,id] of Object.entries(ids))await db.query("insert into auth.users values($1,$2)",[id,label+"@example.invalid"]);
  await db.query("insert into empresas(id,nome,cardapio_slug,pagamento_na_entrega) values($1,'Loja A','loja-teste',true),($2,'Loja B','quiosque-dorafa',true)",[a,b]);
  await db.query("insert into membros values($1,$3,'gestor'),($2,$4,'gestor'),($1,$5,'operador')",[a,b,ids.a,ids.b,ids.op]);
  await db.query("insert into produtos(id,empresa_id,codigo,nome,preco_centavos) values($1,$2,'P','Produto',500),($3,$4,'P','Produto',500)",[uid(1),a,uid(2),b]);
  await db.query("insert into mesas_cardapio(token,empresa_id,numero) values($1,$2,1)",[uid(10),a]);
  await db.query("insert into caixas(id,empresa_id,operador_id,abertura_centavos) values($1,$2,$3,0)",[uid(50),a,ids.op]);
  await db.query("insert into provedores_pagamento(empresa_id,provedor,ambiente,pix_habilitado) values($1,'asaas','producao',true) on conflict do nothing",[b]);
  const antes=await contratos();
  assert.deepEqual(Object.fromEntries(Object.entries(antes).map(([k,r])=>[k,r.corpo])),sigs);
  const fila=(await como("op","select comandas_pendentes($1) dados",[a])).rows[0].dados;
  for(const n of migrations.filter(n=>n>="202611200060"))await db.exec(await read("supabase/migrations/"+n));
  const depois=await contratos();
  for(const sig of Object.keys(sigs)){
    assert.equal(depois[sig].oid,antes[sig].oid);
    assert.equal(depois[sig].acl,antes[sig].acl);
  }
  assert.deepEqual((await como("op","select comandas_pendentes($1) dados",[a])).rows[0].dados,fila);
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



const mesas=async(token,empresa,acao="listar",n=null,ativo=null)=>(await como(token,
  "select painel_mesas($1,$2,$3,$4) dados",[empresa,acao,n,ativo])).rows[0].dados;
const enviar=(id,token,loja="loja-teste",produto=1)=>como(null,"select enviar_pedido($1,$2,'Cliente',$3,$4)",
  [loja,id,token,itens(produto)]);
const trilha=async()=> (await db.query("select acao,autor_id,origem_autor,empresa_id,antes,depois,requisicao_id from painel_privado.auditoria where entidade='mesas_cardapio' order by ocorrido_em,id")).rows;
const achar=(dados,n)=>dados.mesas.find(m=>m.numero===n);

test("mesas legadas conservam o token e ações são atômicas e auditadas sem token",async()=>{
  const antiga=achar(await mesas("a",a),1);
  assert.equal(antiga.ativo,true);assert.equal(antiga.criado_em,null);assert.equal(antiga.mesa,uid(10));
  await assert.rejects(mesas("a",a,"criar",1000),/entre 1 e 999/);
  const criada=achar(await mesas("a",a,"criar",2),2);
  assert.ok(criada.criado_em);
  const pdv=(await como("a","select configurar_mesa_cardapio($1,2) dados",[a])).rows[0].dados;
  assert.equal(pdv.mesa,criada.mesa);
  const off=achar(await mesas("a",a,"situacao",2,false),2);
  assert.equal(off.ativo,false);assert.equal(off.mesa,null);
  assert.equal(achar(await mesas("a",a,"criar",2),2).ativo,false);
  await assert.rejects(enviar(uid(20),criada.mesa),/Mesa inativa/);
  await assert.rejects(como(null,"select iniciar_checkout_pix_sandbox($1,'Cliente',$2,$3)",[uid(21),criada.mesa,itens(1)],"service_role"),/Mesa inativa/);
  const on=achar(await mesas("a",a,"situacao",2,true),2);
  assert.equal(on.mesa,criada.mesa);
  await enviar(uid(20),on.mesa);
  assert.equal(achar(await mesas("a",a),2).comandas_abertas,1);
  await assert.rejects(mesas("a",a,"situacao",2,false),{code:"PT409"});
  await db.query("update pedidos_online set estado='entregue' where id=$1",[uid(20)]);
  const pendentes=(await como("op","select comandas_pendentes($1,'2') dados",[a])).rows[0].dados;
  assert.equal(pendentes[0].id,uid(20));
  assert.equal(achar(await mesas("a",a),2).comandas_abertas,1);
  await assert.rejects(mesas("a",a,"situacao",2,false),{code:"PT409"});
  await db.query("insert into vendas(id,empresa_id,caixa_id,total_centavos,meio) values($1,$2,$3,500,'dinheiro')",[uid(20),a,uid(50)]);
  assert.equal(achar(await mesas("a",a),2).comandas_abertas,0);
  await mesas("a",a,"situacao",2,false);
  await enviar(uid(20),on.mesa);
  await assert.rejects(enviar(uid(22),on.mesa),/Mesa inativa/);
  const audit=await trilha();
  assert.deepEqual(audit.map(x=>x.acao),["mesas.criar","mesas.desativar","mesas.reativar","mesas.desativar"]);
  assert.equal(new Set(audit.map(x=>x.requisicao_id)).size,4);
  assert.ok(audit.every(x=>x.autor_id===ids.a&&x.empresa_id===a&&x.origem_autor==="usuario"));
  assert.doesNotMatch(JSON.stringify(audit),new RegExp(criada.mesa));
  assert.deepEqual(audit[1].antes,{ativo:true});assert.deepEqual(audit[1].depois,{ativo:false});
});

test("reserva Pix de produção respeita mesa inativa e entrega sem mesa permanece operante",async()=>{
  const token=achar(await mesas("b",b,"criar",3),3).mesa;
  await mesas("b",b,"situacao",3,false);
  await assert.rejects(como(null,"select reservar_pix_quiosque($1,'Cliente',$2,$3)",[uid(23),token,itens(2)],"service_role"),/Mesa inativa/);
  await assert.rejects(enviar(uid(23),token),/Mesa inválida/);
  const endereco=JSON.stringify({logradouro:"Rua",numero:"10",bairro:"Bairro",cidade:"Cidade"});
  for(const [i,n] of ["enviar_pedido_pagamento_na_entrega","enviar_pedido_pagamento_na_entrega_com_frete"].entries())
    assert.equal((await como(null,"select "+n+"('loja-teste',$1,'Cliente',$2,$3,0) id",[uid(24+i),itens(1),endereco],"service_role")).rows[0].id,uid(24+i));
  await mesas("b",b,"situacao",3,true);
  const r=await como(null,"select reservar_pix_quiosque($1,'Cliente',$2,$3) dados",[uid(23),token,itens(2)],"service_role");
  assert.equal(r.rows[0].dados.criar,true);
});

test("auditoria falha junto com a gravação, e RPC/tabela restringem escopo",async()=>{
  for(const [ator,empresa] of [["a",b],["b",a],["op",a],[null,a],["a",null]]){
    await assert.rejects(mesas(ator,empresa),{code:"42501"});
    await assert.rejects(mesas(ator,empresa,"situacao",1,false),{code:"42501"});
  }
  await assert.rejects(como("a","select * from mesas_cardapio"),{code:"42501"});
  await assert.rejects(mesas("b",b,"situacao",1,false),{code:"PT404"});
  const antes=await trilha();
  await db.exec(`create function public.fixture_mesa() returns trigger language plpgsql as $$
  begin raise check_violation; end $$;
  create trigger fixture_mesa before insert on painel_privado.auditoria for each row
  when (new.acao='mesas.desativar') execute function public.fixture_mesa();`);
  await assert.rejects(mesas("a",a,"situacao",1,false),{code:"23514"});
  assert.equal(achar(await mesas("a",a),1).ativo,true);
  assert.deepEqual(await trilha(),antes);
  await db.exec("drop trigger fixture_mesa on painel_privado.auditoria");
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
      return Response.json(await mesas(token,p.p_empresa,p.p_acao,p.p_numero??null,p.p_ativo??null));
    }catch(e){
      const status={42501:403,P0001:400,22023:400,PT404:404,PT409:409}[e.code];
      if(!status)throw e;
      return new Response(null,{status});
    }
  });
}
async function api(path,token,method="GET",body){
  const url=new URL(path,"http://localhost");
  const rewrite=config.rewrites.find(r=>r.source===url.pathname);
  const query=Object.fromEntries(url.searchParams);
  if(rewrite)Object.assign(query,Object.fromEntries(new URL(rewrite.destination,url).searchParams));
  const ret={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(d){this.body=d;},end(){}};
  await handler({query,method,body,headers:token?{authorization:"Bearer "+token}:{}},ret);
  assert.equal(ret.headers["Cache-Control"],"no-store");
  return ret;
}



test("Function e rewrite concordam para leitura, escrita e autorização",async t=>{
  simular(t);
  for(const path of ["/api/painel-mesas?","/api/cadastrar-operador?painel_mesas=1&"]){
    for(const [user,loja,status] of [["a",a,200],["b",b,200],["a",b,403],["b",a,403],["op",a,403],[null,a,401],["inválido",a,401]]){
      const url=path+"empresa_id="+loja;
      assert.equal((await api(url,user)).code,status);
      assert.equal((await api(url,user,"POST",{acao:"criar",numero:40})).code,status);
    }
    assert.equal((await api(path+"empresa_id="+a,"a","POST",{acao:"criar",numero:1000})).code,400);
    assert.equal((await api(path+"empresa_id="+b,"b","POST",{acao:"situacao",numero:3,ativo:false})).code,409);
  }
});
test("Chrome cria mesa, mostra QR e mantém o link após reativação",{
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
        const r=await api(req.url,req.headers.authorization?.split(" ")[1],req.method,raw?JSON.parse(raw):undefined);
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
    await pagina.getByRole("button",{name:"Mesas",exact:true}).click();
    const area=pagina.locator("#area-mesas");
    await area.getByLabel("Número da mesa").fill("15");
    await area.getByRole("button",{name:"Criar mesa"}).click();
    const qr=area.getByRole("dialog");
    await qr.getByRole("heading",{name:"Mesa 15"}).waitFor();
    const link=await qr.getByLabel("Link da mesa").inputValue();
    const url=new URL(link);
    assert.equal(url.pathname,"/cardapio.html");
    assert.equal(url.searchParams.get("loja"),"loja-teste");
    assert.equal(url.searchParams.get("mesa"),achar(await mesas("a",a),15).mesa);
    const imagem=qr.getByRole("img",{name:"QR Code do cardápio da mesa"});
    assert.match(await imagem.getAttribute("src"),/^data:image\/gif;base64,/);
    await pagina.emulateMedia({media:"print"});
    assert.equal(await area.locator("dialog img").evaluate(img=>getComputedStyle(img).visibility),"visible");
    assert.equal(await area.getByRole("table").isVisible(),false);
    await pagina.emulateMedia({media:"screen"});
    await qr.getByRole("button",{name:"Fechar",exact:true}).click();
    const row=area.getByRole("row").filter({has:pagina.getByRole("cell",{name:"15",exact:true})});
    pagina.on("dialog",d=>d.accept());
    await row.getByRole("button",{name:"Desativar"}).click();
    await row.getByRole("cell",{name:"Inativa",exact:true}).waitFor();
    assert.equal(await row.getByRole("button",{name:"Ver QR"}).count(),0);
    await row.getByRole("button",{name:"Reativar"}).click();
    await row.getByRole("button",{name:"Ver QR"}).click();
    await qr.getByRole("heading",{name:"Mesa 15"}).waitFor();
    assert.equal(await qr.getByLabel("Link da mesa").inputValue(),link);
  }finally{servidor.close();await navegador.close();}
});
