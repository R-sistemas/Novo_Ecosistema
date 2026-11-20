import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import handler from "../api/cadastrar-operador.mjs";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname,"..");
const read = path => readFile(resolve(root,path),"utf8");
const config = JSON.parse(await read("vercel.json"));
const A = "30000000-0000-0000-0000-00000000000a";
const B = "30000000-0000-0000-0000-00000000000b";
const users = new Map([["a","40000000-0000-0000-0000-000000000001"],
  ["b","40000000-0000-0000-0000-000000000002"],["op","40000000-0000-0000-0000-000000000003"]]);
const ambiente = "servico-fixture";

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon,authenticated,service_role;
  `);
  for (const n of (await readdir(resolve(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")).sort()) {
    await db.exec(await read("supabase/migrations/"+n));
  }
  for (const [nome,id] of users) await db.query("insert into auth.users values($1,$2)",[id,nome+"@example.invalid"]);
  await db.query("insert into empresas(id,nome) values($1,'A'),($2,'B')",[A,B]);
  await db.query("insert into membros values($1,$3,'gestor'),($2,$4,'gestor'),($1,$5,'operador')",
    [A,B,users.get("a"),users.get("b"),users.get("op")]);
});
after(() => db.close());

const queries = {
  enviar_aviso_pedido:["p_empresa","p_pedido","p_mensagem"],
  painel_contexto_sessao:["p_empresa_id"], painel_equipe:["p_empresa","p_acao","p_dados"],
  painel_iniciar_cadastro_operador:["p_gestor","p_empresa","p_email","p_perfil"],
  painel_concluir_cadastro_operador:["p_requisicao","p_operador","p_caixa","p_resultado"],
  painel_listar_produtos:["p_empresa_id","p_cursor","p_limite"]
};
async function como(token,sql,params, role = token === ambiente ? "service_role" : "authenticated") {
  return db.transaction(async tx => {
    await tx.exec("set local role "+role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [users.get(token) ?? "",role]);
    return tx.query(sql,params);
  });
}

async function supabase(url,init) {
  const token = init.headers.Authorization?.replace(/^Bearer /,"");
  if (token!==ambiente && !users.has(token)) return new Response(null,{status:401});
  const path = url.pathname;
  if (path==="/auth/v1/user") {
    const {rows} = await db.query("select id from auth.users where id=$1",[users.get(token)]);
    return rows.length ? Response.json(rows[0]) : new Response(null,{status:401});
  }
  const dados = init.body ? JSON.parse(init.body) : {};
  try {
    if (path==="/auth/v1/admin/users" && token===ambiente) {
      const id=randomUUID();
      await db.query("insert into auth.users values($1,$2)",[id,dados.email]);
      users.set(dados.email,id);
      return Response.json({id});
    }
    if (path.startsWith("/auth/v1/admin/users/") && token===ambiente) {
      const id=path.split("/").at(-1);
      await db.query("delete from auth.users where id=$1",[id]);
      return new Response(null,{status:204});
    }
    const nome=path.split("/").at(-1);
    const campos=queries[nome];
    assert.ok(campos);
    const args=campos.map((_,i)=>"$"+(i+1)).join(",");
    const params=campos.map(k=>typeof dados[k]==="object"&&dados[k]!==null ? JSON.stringify(dados[k]) : dados[k]);
    const {rows} = await como(token,"select "+nome+"("+args+") as resultado",params);
    return Response.json(rows[0].resultado);
  } catch (e) {
    const status={42501:403,23505:409,23514:400,22023:400,P0001:400}[e.code];
    if (!status) throw e;
    return new Response(null,{status});
  }
}

function mock(t, fn=supabase) {
  process.env.SUPABASE_URL="https://banco.example";
  process.env.SUPABASE_ANON_KEY="fixture";
  process.env.SUPABASE_SERVICE_ROLE_KEY=ambiente;
  t.mock.method(globalThis,"fetch",(url,init)=>fn(new URL(url),init));
}
const url = empresa => "/api/painel-equipe?empresa_id="+empresa;
async function api(path,token,body) {
  const origem=new URL(path,"http://localhost");
  const rewrite=config.rewrites.find(r=>r.source===origem.pathname);
  const query=Object.fromEntries(origem.searchParams);
  if(rewrite) Object.assign(query,Object.fromEntries(new URL(rewrite.destination,origem).searchParams));
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(data){this.body=data;},end(){}};
  await handler({query,headers:token?{authorization:"Bearer "+token}:{},method:body?"POST":"GET",body},res);
  assert.equal(res.headers["Cache-Control"],"no-store");
  return res;
}
const equipe = (token,empresa,acao,dados={}) => como(token,
  "select painel_equipe($1,$2,$3) as resultado",[empresa,acao,JSON.stringify(dados)]);
const entrada = email => ({acao:"cadastrar",email,senha:"fixture-longa-123",caixa:"Caixa "+email.split("@")[0]});
const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
const registrar = email => rows(`select acao,depois,autor_id,origem_autor,empresa_id,requisicao_id
 from painel_privado.auditoria where depois->>'email'=$1 or antes->>'email'=$1 order by ocorrido_em,id`,[email]);

test("isolamento A/B, operador, sessão e papéis elevados no dispatcher e na RPC direta",async t=>{
  mock(t);
  assert.equal((await api(url(A),null)).code,401);
  assert.equal((await api(url(A),"expirado")).code,401);
  for(const [token,propria,outra] of [["a",A,B],["b",B,A],["op",null,A]]){
    if(propria)assert.equal((await api(url(propria),token)).code,200);
    assert.equal((await api(url(outra),token)).code,403);
    for(const acao of ["listar","remover","terminal","nome_pdv"]){
      await assert.rejects(equipe(token,outra,acao),{code:"42501"});
      if(acao!=="listar") assert.equal((await api(url(outra),token,{acao,dados:{}})).code,403);
    }
    assert.equal((await api(url(outra),token,entrada("negado@example.invalid"))).code,403);
  }
  assert.equal((await api(url(A),"a",{...entrada("x@example.invalid"),papel:"gestor"})).code,400);
  assert.equal((await api(url(A),"a",entrada("a@example.invalid"))).code,403);
  await assert.rejects(equipe("a",A,"remover",{email:"a@example.invalid"}),{code:"42501"});
  await assert.rejects(equipe("a",A,"terminal",{email:"a@example.invalid",nome:"Próprio"}),{code:"42501"});
  await assert.rejects(como("a","select painel_iniciar_cadastro_operador($1,$2,$3,'vendas')",
    [users.get("a"),A,"x@example.invalid"]),{code:"42501"});
});

test("cadastro legado, configuração e remoção auditam, e a próxima chamada perde o acesso à loja",async t=>{
  mock(t);
  const email="legado@example.invalid";
  const {email:_,senha,caixa}=entrada(email);
  assert.equal((await api("/api/cadastrar-operador","a",{empresa:A,email,senha,caixa})).code,201);
  const inicial=await registrar(email);
  assert.deepEqual(inicial.map(x=>x.acao).sort(),["auth.operador.tentativa","membros.criar","terminais_pdv.criar","auth.operador.resultado"].sort());
  assert.equal(new Set(inicial.map(x=>x.requisicao_id)).size,1);
  assert.ok(inicial.every(x=>x.autor_id===users.get("a")&&x.origem_autor==="usuario"&&x.empresa_id===A));
  assert.doesNotMatch(JSON.stringify(inicial),/fixture-longa|password|token/i);
  const loja=(await api(url(A),"a")).body;
  const terminal=loja.terminais.find(x=>x.email===email);
  assert.equal(terminal.ultimo_uso,null);
  assert.equal((await api(url(A),"a",{acao:"terminal",dados:{id:terminal.id,nome:"Atualizado",email}})).code,200);
  assert.equal((await api(url(A),"a",{acao:"nome_pdv",dados:{nome:"PDV A"}})).code,200);
  const nome=(await api(url(A),"a")).body.nome_pdv;
  assert.equal(nome,"PDV A");
  assert.equal((await rows("select * from painel_privado.auditoria where acao='empresas.editar' and empresa_id=$1",[A])).length,1);
  assert.equal((await registrar(email)).filter(x=>x.acao==="terminais_pdv.editar").length,1);

  const {rows:[turno]}=await como(email,"select abrir_caixa($1,0,$2) as id",[A,terminal.id]);
  assert.ok((await api(url(A),"a")).body.terminais.find(x=>x.id===terminal.id).ultimo_uso);
  assert.equal((await api(url(A),"a",{acao:"remover",dados:{email}})).code,400);
  await rows("update caixas set fechado_em=now(),contado_centavos=0 where id=$1",[turno.id]);
  assert.equal((await api(url(A),"a",{acao:"remover",dados:{email}})).code,200);
  await assert.rejects(como(email,"select abrir_caixa($1,0,$2)",[A,terminal.id]),{code:"42501"});
  assert.equal((await como(email,"select empresa_id from membros where empresa_id=$1",[A])).rows.length,0);
  assert.equal((await api(url(A),"a")).body.operadores.some(x=>x.email===email),false);
  assert.equal((await supabase(new URL("https://banco.example/auth/v1/user"),{headers:{Authorization:"Bearer "+email}})).status,200);
  assert.equal((await registrar(email)).filter(x=>x.acao==="membros.excluir").length,1);
});

test("falha na auditoria de resultado reverte vínculo e caixa e registra compensação do Auth",async t=>{
  mock(t);
  await db.exec(`
   create function public.fixture_falha_equipe() returns trigger language plpgsql as $$
    begin raise check_violation; end $$;
   create trigger fixture_falha_equipe before insert on painel_privado.auditoria for each row
   when (new.acao='auth.operador.resultado' and new.depois->>'email'='falha@example.invalid' and new.depois->>'resultado'='vinculado')
   execute function public.fixture_falha_equipe();
  `);
  const email="falha@example.invalid";
  assert.equal((await api(url(A),"a",entrada(email))).code,409);
  assert.equal((await rows("select id from auth.users where email=$1",[email])).length,0);
  assert.equal((await rows("select id from terminais_pdv where operador_id=$1",[users.get(email)])).length,0);
  const audit=await registrar(email);
  assert.deepEqual(audit.map(x=>x.acao).sort(),["auth.operador.tentativa","auth.operador.resultado"].sort());
  assert.equal(audit.find(x=>x.acao==="auth.operador.resultado").depois.resultado,"auth_revertido");
  assert.equal(audit[0].requisicao_id,audit[1].requisicao_id);
});

test("resposta perdida após commit reconcilia a mesma requisição sem repetir Auth",async t=>{
  let perdido=false;
  mock(t,async (u,i)=>{
    const res=await supabase(u,i);
    if(!perdido&&u.pathname.endsWith("painel_concluir_cadastro_operador")&&res.ok){
      perdido=true;throw new Error("Transporte interrompido depois do commit");
    }
    return res;
  });
  const email="reconciliado@example.invalid";
  assert.equal((await api(url(A),"a",entrada(email))).code,201);
  assert.equal((await registrar(email)).filter(x=>x.acao==="auth.operador.resultado").length,1);
  assert.equal((await rows("select id from auth.users where email=$1",[email])).length,1);
});

test("Chrome percorre login, equipe, cadastro, listagem e remoção",{
  skip:!process.env.PAINEL_PLAYWRIGHT_MODULE||!process.env.PAINEL_CHROME_PATH
},async t=>{
  mock(t);
  const {chromium}=require(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const navegador=await chromium.launch({executablePath:process.env.PAINEL_CHROME_PATH,headless:true,
    args:["--disable-background-networking","--disable-component-update"]});
  const tipos={".html":"text/html",".mjs":"text/javascript",".css":"text/css"};
  const servidor=createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,"http://localhost");
      if(u.pathname.startsWith("/api/")){
        const partes=[];
        for await(const parte of req)partes.push(parte);
        const corpo=Buffer.concat(partes).toString();
        const r=await api(req.url,req.headers.authorization?.split(" ")[1],corpo?JSON.parse(corpo):undefined);
        res.writeHead(r.code,{"Content-Type":"application/json",...r.headers});
        return res.end(JSON.stringify(r.body));
      }
      const arquivo=resolve(root,"."+u.pathname);
      if(!arquivo.startsWith(root+sep))return res.writeHead(403).end();
      res.writeHead(200,{"Content-Type":tipos[extname(arquivo)]??"text/plain"});
      res.end(await readFile(arquivo));
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  try{
    await new Promise(resolve=>servidor.listen(0,"127.0.0.1",resolve));
    const pagina=await navegador.newPage();
    pagina.on("dialog",d=>d.accept());
    await pagina.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async route=>{
      const u=new URL(route.request().url());
      if(u.pathname==="/auth/v1/token")return route.fulfill({json:{user:{id:users.get("a")},access_token:"a",refresh_token:"fixture",expires_in:3600}});
      assert.equal(u.pathname,"/rest/v1/membros");
      return route.fulfill({json:[{empresas:{id:A,nome:"A"}}]});
    });
    const base="http://127.0.0.1:"+servidor.address().port;
    await pagina.goto(base+"/admin-loja.html");
    await pagina.getByLabel("E-mail",{exact:true}).fill("a@example.invalid");
    await pagina.getByLabel("Senha",{exact:true}).fill("fixture");
    await pagina.getByRole("button",{name:"Entrar"}).click();
    await pagina.locator("#pagina").getByText("Página 1",{exact:true}).waitFor();
    await pagina.getByRole("button",{name:"Equipe e terminais"}).click();
    const email="browser@example.invalid";
    await pagina.getByLabel("E-mail do operador").fill(email);
    await pagina.getByLabel("Senha inicial").fill("fixture-longa-123");
    await pagina.getByLabel("Caixa do operador").fill("Caixa Browser");
    await pagina.getByRole("button",{name:"Cadastrar operador"}).click();
    const remover=pagina.getByRole("button",{name:"Remover "+email});
    await remover.waitFor();
    await pagina.locator("[data-terminais]").getByText(/Caixa Browser/).waitFor();
    await remover.click();
    await remover.waitFor({state:"detached"});
    const trilha=await registrar(email);
    assert.deepEqual(trilha.map(r=>r.acao).sort(),["auth.operador.tentativa","membros.criar","terminais_pdv.criar","auth.operador.resultado","membros.excluir"].sort());
    const cozinha="browser-cozinha@example.invalid";
    await pagina.locator("[data-cadastro] select[name=perfil]").selectOption("cozinha");
    assert.equal(await pagina.getByLabel("Caixa do operador").isVisible(),false);
    await pagina.getByLabel("E-mail do operador").fill(cozinha);
    await pagina.getByLabel("Senha inicial").fill("fixture-longa-123");
    await pagina.getByRole("button",{name:"Cadastrar operador"}).click();
    const linha=pagina.locator("[data-operadores] li").filter({hasText:cozinha});
    await linha.getByText("Cozinha",{exact:true}).waitFor();
    const editar=linha.getByRole("checkbox",{name:/Pode editar comanda/});
    const contato=linha.getByRole("checkbox",{name:/Pode contatar cliente/});
    await editar.click();
    await pagina.waitForFunction(() => document.querySelector('[aria-label="Pode editar comanda · browser-cozinha@example.invalid"]')?.checked);
    await contato.click();
    await pagina.waitForFunction(() => document.querySelector('[aria-label="Pode contatar cliente · browser-cozinha@example.invalid"]')?.checked);
    assert.ok(!(await pagina.locator("[data-terminal] select[name=email] option").allTextContents()).includes(cozinha));
    await linha.getByRole("button",{name:/Remover/}).click();
    await linha.waitFor({state:"detached"});
  }finally{servidor.close();await navegador.close();}
});

test("cadastro legado KDS mantém o contrato e audita o vínculo de cozinha",async t=>{
  mock(t);
  const email="cozinha@example.invalid";
  assert.equal((await api("/api/cadastrar-operador","a",{empresa:A,email,senha:"fixture-longa-123",caixa:null,perfil:"cozinha"})).code,201);
  assert.equal((await rows("select usuario_id from membros where usuario_id=$1",[users.get(email)])).length,0);
  assert.equal((await rows("select usuario_id from equipe_kds where usuario_id=$1 and empresa_id=$2",[users.get(email),A])).length,1);
  const audit=await registrar(email);
  assert.deepEqual(audit.map(r=>r.acao).sort(),["auth.operador.tentativa","equipe_kds.criar","auth.operador.resultado"].sort());
  assert.equal(new Set(audit.map(r=>r.requisicao_id)).size,1);
});

test("painel cadastra cozinha sem caixa, aplica permissões e remove vínculo",async t=>{
  mock(t);
  const email="painel-cozinha@example.invalid";
  const cadastro={...entrada(email),perfil:"cozinha",caixa:null};
  assert.equal((await api(url(A),"a",{...cadastro,caixa:"Indevido"})).code,400);
  assert.equal((await api(url(B),"a",cadastro)).code,403);
  assert.equal((await api(url(A),"a",cadastro)).code,201);
  const ler=async()=> (await api(url(A),"a")).body.operadores.find(o=>o.email===email);
  assert.deepEqual(await ler(),{email,vendas:false,cozinha:true,edita_comanda:false,contato_cliente:false,caixas:[]});
  assert.equal((await api(url(A),"a",{acao:"terminal",dados:{email,nome:"Indevido"}})).code,403);
  for (const acao of ["edicao_comanda","contato_cliente"]) {
    const dados={email,permitir:true};
    assert.equal((await api(url(B),"a",{acao,dados})).code,403);
    assert.equal((await api(url(A),"b",{acao,dados})).code,403);
    assert.equal((await api(url(A),"op",{acao,dados})).code,403);
    assert.equal((await api(url(A),"a",{acao,dados:{email,permitir:"true"}})).code,400);
    assert.equal((await api(url(A),"a",{acao,dados})).code,200);
  }
  assert.equal((await ler()).edita_comanda,true);
  assert.equal((await ler()).contato_cliente,true);
  assert.equal((await api(url(A),"a",{acao:"remover",dados:{email}})).code,200);
  assert.equal(await ler(),undefined);
  const trilha=await registrar(email);
  const edicoes=trilha.filter(r=>r.acao==="equipe_kds.editar");
  assert.equal(edicoes.length,2);
  assert.ok(edicoes.some(r=>r.depois.contato_cliente===true));
  assert.ok(edicoes.some(r=>r.depois.edita_comanda===true));
  assert.equal(trilha.find(r=>r.acao==="equipe_kds.excluir")?.autor_id,users.get("a"));
  assert.deepEqual((await como(email,"select * from lojas_kds()",[])).rows,[]);
});

test("cozinha avisa apenas pedidos próprios e vê telefone apenas sob permissão",async ()=>{
  const cozinha="cozinha@example.invalid";
  const [entrega,mesa,outra]=Array.from({length:3},()=>randomUUID());
  await db.query("update empresas set cardapio_slug=case when id=$1 then 'equipe-a' else 'equipe-b' end where id in ($1,$2)",[A,B]);
  await db.query(`insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,estado,mesa)
    values($1,$4,'Entrega','[{"nome":"Teste","quantidade":1}]',2000,'preparo',null),
    ($2,$4,'Mesa','[{"nome":"Teste","quantidade":1}]',2000,'preparo',7),
    ($3,$5,'Outra','[{"nome":"Teste","quantidade":1}]',2000,'preparo',null)`,[entrega,mesa,outra,A,B]);
  await db.query(`insert into entregas_pedido values
    ($1,'{"logradouro":"Rua fictícia","telefone":"11922223333"}','na_entrega',300)`,[entrega]);
  const fila=async()=> (await como(cozinha,"select fila_cozinha($1) as fila",[A])).rows[0].fila;
  assert.equal((await fila()).find(p=>p.id===entrega).telefone_cliente,undefined);
  assert.equal((await fila()).find(p=>p.id===mesa).pode_avisar,false);
  await assert.rejects(()=>como(cozinha,"select configurar_contato_cliente_kds($1,$2,true)",[A,cozinha]),{code:"42501"});
  await equipe("a",A,"contato_cliente",{email:cozinha,permitir:true});
  const f=await fila();
  assert.equal(f.find(p=>p.id===entrega).telefone_cliente,"11922223333");
  assert.equal(f.find(p=>p.id===entrega).endereco_entrega,undefined);
  assert.equal(f.find(p=>p.id===mesa).telefone_cliente,undefined);
  assert.equal(f.find(p=>p.id===mesa).pode_avisar,true);
  assert.ok(!f.some(p=>p.id===outra));
  const avisar=(token,loja,pedido,msg="Sem maionese. Podemos trocar?")=>
    como(token,"select enviar_aviso_pedido($1,$2,$3)",[loja,pedido,msg]);
  await assert.rejects(()=>avisar(cozinha,B,outra),{code:"42501"});
  await assert.rejects(()=>avisar(cozinha,A,outra),{code:"42501"});
  await assert.rejects(()=>avisar("op",A,entrega),{code:"42501"});
  await assert.rejects(()=>avisar(cozinha,A,entrega,"  "),{code:"22023"});
  await assert.rejects(()=>avisar(cozinha,A,entrega,"x".repeat(241)),{code:"22023"});
  const acompanha=async(slug,id)=>(await como(null,"select acompanhar_pedido($1,$2) as pedido",[slug,id],"anon")).rows[0].pedido;
  assert.deepEqual((await acompanha("equipe-a",entrega)).avisos,[]);
  await avisar(cozinha,A,entrega);
  const aviso=(await acompanha("equipe-a",entrega)).avisos[0];
  assert.equal(aviso.mensagem,"Sem maionese. Podemos trocar?");
  assert.deepEqual(Object.keys(aviso).sort(),["criado_em","mensagem"]);
  assert.deepEqual((await acompanha("equipe-a",mesa)).avisos,[]);
  assert.deepEqual((await acompanha("equipe-b",outra)).avisos,[]);
  assert.equal(await acompanha("equipe-b",entrega),null);
  assert.equal((await fila()).find(p=>p.id===entrega).avisos[0].mensagem,aviso.mensagem);
  await assert.rejects(()=>como(null,"select * from painel_privado.avisos_pedido",[],"anon"),{code:"42501"});
  const trilha=await rows("select autor_id,empresa_id,depois from painel_privado.auditoria where acao='avisos_pedido.criar'");
  assert.deepEqual(trilha,[{autor_id:users.get(cozinha),empresa_id:A,depois:{pedido_id:entrega}}]);
  await equipe("a",A,"contato_cliente",{email:cozinha,permitir:false});
  assert.equal((await fila()).find(p=>p.id===entrega).telefone_cliente,undefined);
  await db.exec(`create function painel_privado.teste_bloquear_aviso() returns trigger language plpgsql as $teste$
    begin
      if new.acao='avisos_pedido.criar' then raise exception 'Falha de auditoria simulada'; end if;
      return new;
    end;
  $teste$;
    create trigger teste_bloquear_aviso before insert on painel_privado.auditoria
      for each row execute function painel_privado.teste_bloquear_aviso();`);
  try {
    await assert.rejects(()=>avisar("a",A,mesa,"Reverter"),{code:"P0001"});
    assert.deepEqual((await acompanha("equipe-a",mesa)).avisos,[]);
  } finally {
    await db.exec("drop trigger teste_bloquear_aviso on painel_privado.auditoria; drop function painel_privado.teste_bloquear_aviso()");
  }
  await avisar("a",A,mesa,"Aviso de mesa");
  assert.equal((await acompanha("equipe-a",mesa)).avisos[0].mensagem,"Aviso de mesa");
});

test("RPC de aviso exige contato_cliente para cozinha e preserva acesso do gestor",async ()=>{
  const cozinha="cozinha@example.invalid";
  const pedido=randomUUID();
  await db.query(`insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,estado)
    values($1,$2,'Cliente de teste','[{"nome":"Teste","quantidade":1}]',1000,'preparo')`,[pedido,A]);
  const fila=async token=>(await como(token,"select fila_cozinha($1) as fila",[A])).rows[0].fila.find(p=>p.id===pedido);
  const enviar=async token=>(await supabase(new URL("https://banco.example/rest/v1/rpc/enviar_aviso_pedido"),{
    headers:{Authorization:"Bearer "+token},
    body:JSON.stringify({p_empresa:A,p_pedido:pedido,p_mensagem:"Aviso de teste"})
  })).status;
  assert.equal((await fila(cozinha)).pode_avisar,false);
  assert.equal(await enviar(cozinha),403);
  assert.equal((await fila("a")).pode_avisar,true);
  assert.equal(await enviar("a"),200);
  await equipe("a",A,"contato_cliente",{email:cozinha,permitir:true});
  assert.equal((await fila(cozinha)).pode_avisar,true);
  assert.equal(await enviar(cozinha),200);
  await equipe("a",A,"contato_cliente",{email:cozinha,permitir:false});
  assert.equal((await fila(cozinha)).pode_avisar,false);
  assert.equal(await enviar(cozinha),403);
});
