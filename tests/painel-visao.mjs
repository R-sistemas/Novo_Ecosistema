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
let monitorAnterior;
const dia="2026-11-20", fim="2026-11-21";
const uid=n=>"50000000-0000-0000-0000-"+String(n).padStart(12,"0");
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
  for(const n of (await readdir(resolve(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")&&n<"202611200058").sort())
    await db.exec(await read("supabase/migrations/"+n));
  for(const [label,id] of Object.entries(ids))await db.query("insert into auth.users values($1,$2)",[id,label+"@example.invalid"]);
  await db.query("insert into empresas(id,nome,cardapio_slug) values($1,'Loja A','a'),($2,'Loja B','b')",[a,b]);
  await db.query("insert into membros values($1,$3,'gestor'),($2,$4,'gestor'),($1,$5,'operador')",[a,b,ids.a,ids.b,ids.op]);
  await db.exec(`
    insert into public.caixas(id,empresa_id,operador_id,abertura_centavos)
    values ('${uid(90)}','${a}','${ids.op}',0);
    insert into public.pedidos_online(id,empresa_id,cliente,itens,total_centavos,estado,criado_em,pix_sandbox_solicitado,pix_sandbox_confirmado_em,pix_sandbox_cobranca_id)
    select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      case when n=9 then '${b}'::uuid else '${a}'::uuid end,'Cliente','[]',1000,
      case when n in (2,3) then 'pronto' else 'novo' end,
      case when n=1 then '2026-11-20 03:00+00'::timestamptz
        when n=8 then '2026-11-21 03:00+00'::timestamptz else '2026-11-20 15:00+00'::timestamptz end,
      n=6,case when n=6 then '2026-11-20 15:00+00'::timestamptz end,case when n=6 then 'sandbox-6' end
    from generate_series(1,9) n;
    insert into public.entregas_pedido(pedido_id,endereco,pagamento) values
      ('${uid(2)}','{}','na_entrega'),('${uid(3)}','{}','na_entrega');
    insert into remo.solicitacoes(origem,ambiente,referencia,solicitante,destino,estado,cobrar_na_entrega_centavos)
      values ('r_sistemas','producao','${uid(2)}','${a}','{}','entregue',1000);
    insert into public.cancelamentos_comanda(id,pedido_id,solicitado_por,motivo,estado)
      values ('${uid(91)}','${uid(7)}','${ids.a}','Teste','cancelado');
    insert into public.vendas(id,caixa_id,empresa_id,total_centavos,meio,criado_em)
      select id,'${uid(90)}','${a}',1000,'dinheiro','2026-11-20 15:00+00'
        from public.pedidos_online where id in ('${uid(1)}','${uid(2)}','${uid(6)}');
    insert into public.provedores_pagamento(empresa_id,provedor,ambiente) values ('${a}','teste','producao');
    insert into public.pagamentos_online(pedido_id,empresa_id,provedor,meio,valor_centavos,cobranca_id,confirmado_em) values
      ('${uid(1)}','${a}','teste','credito',1000,'t1','2026-11-20 15:00+00'),
      ('${uid(4)}','${a}','teste','pix',500,'t4','2026-11-20 15:00+00'),
      ('${uid(5)}','${a}','teste','debito',1000,null,null);
  `);
  assert.equal((await db.query("select md5(replace(prosrc,chr(13)||chr(10),chr(10))) md5 from pg_proc where oid=\'public.monitor_gestor(uuid,date)\'::regprocedure")).rows[0].md5,"90924b48898ab44cc31303411c093872");
  monitorAnterior=await monitor();
  for(const n of ["202611200058_compartilhar_criterios_monitor.sql","202611200059_painel_visao_geral.sql"])
    await db.exec(await read("supabase/migrations/"+n));
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


const monitor=async()=> (await como("a","select monitor_gestor($1,$2) dados",[a,dia])).rows[0].dados;
const visao=async(token,empresa,inicio=dia,ate=fim)=>(await como(token,
  "select painel_visao_geral($1,$2,$3) dados",[empresa,inicio,ate])).rows[0].dados;

test("Monitor mantém contrato e totais em paridade, sem cobrar pendentes nem contar venda duplicada",async()=>{
  const atual=await monitor();
  assert.deepEqual(atual,monitorAnterior);
  const r=await visao("a",a);
  for(const k of ["recebimentos_total","recebido_caixa","recebido_online"])assert.equal(r[k],atual[k],k);
  assert.equal(r.pedidos_total,6);
  assert.equal(atual.pedidos_total,7);
  assert.equal(r.receita_centavos,2500);
  assert.equal(r.ticket_medio_centavos,833);
  assert.equal(r.pendentes_online,1);
  assert.deepEqual(r.por_estado,{novo:3,preparo:0,pronto:1,entregue:1,recusado:0,cancelado:1});
  assert.deepEqual(r.por_canal,{pix:500,credito:1000,debito:0,na_entrega:1000,dinheiro:0,cartao:0});
  assert.deepEqual(r.serie,[{dia,pedidos:6,recebimentos:3,receita_centavos:2500}]);
  assert.equal((await visao("a",a,fim,"2026-11-22")).pedidos_total,1);
  const zero=await visao("a",a,"2026-11-01","2026-11-03");
  assert.equal(zero.pedidos_total,0);
  assert.equal(zero.receita_centavos,0);
  assert.equal(zero.ticket_medio_centavos,null);
  assert.equal(zero.serie.length,2);
});

test("RPC direta protege a loja e limita períodos",async()=>{
  for(const [user,empresa] of [["a",b],["b",a],["op",a],[null,a],["a",null]])
    await assert.rejects(visao(user,empresa),{code:"42501"});
  for(const [de,ate] of [[dia,dia],[fim,dia],[null,fim],[dia,"infinity"],["2025-01-01",fim]])
    await assert.rejects(visao("a",a,de,ate),{code:"22023"});
  await assert.rejects(como("a","select * from painel_privado.monitor_recebimentos"),{code:"42501"});
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
      if(rpc==="painel_listar_pedidos")return Response.json((await como(token,"select painel_listar_pedidos($1,$2,$3) dados",[p.p_empresa,p.p_inicio??null,p.p_fim??null])).rows[0].dados);
      return Response.json(await visao(token,p.p_empresa,p.p_inicio,p.p_fim));
    }catch(e){
      const status={42501:403,22023:400}[e.code];
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


test("Function e rewrite concordam para gestores, operador, sessão e intervalo",async t=>{
  simular(t);
  for(const path of ["/api/painel-visao?","/api/cadastrar-operador?painel_visao=1&"]){
    for(const [user,loja,status] of [["a",a,200],["b",b,200],["a",b,403],["b",a,403],["op",a,403],[null,a,401],["inválido",a,401]])
      assert.equal((await api(path+new URLSearchParams({empresa_id:loja,inicio:dia,fim}),user)).code,status);
    for(const invalid of ["2027-11-23","2026-11-31",dia])
      assert.equal((await api(path+new URLSearchParams({empresa_id:a,inicio:dia,fim:invalid}),"a")).code,400);
  }
});
test("Chrome troca períodos, distingue zero de erro e abre atalhos",{
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
    await pagina.clock.setFixedTime(new Date("2026-11-20T15:00:00Z"));
    await pagina.getByText("Página 1",{exact:true}).waitFor();
    await pagina.getByRole("button",{name:"Visão geral",exact:true}).click();
    const area=pagina.locator("#area-visao"), tabela=area.getByRole("table",{name:"Série diária"});
    await tabela.getByText("20/11/2026",{exact:true}).waitFor();
    await area.getByLabel("Período",{exact:true}).selectOption("7");
    await tabela.getByText("14/11/2026",{exact:true}).waitFor();
    assert.equal(await tabela.locator("tbody tr").count(),7);
    await area.getByRole("button",{name:"Ver pedidos do período"}).click();
    const pedidos=pagina.locator("#area-pedidos");
    await pedidos.getByRole("status").getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await pedidos.getByLabel("De",{exact:true}).inputValue(),"2026-11-14");
    assert.equal(await pedidos.getByLabel("Até",{exact:true}).inputValue(),dia);
    assert.equal(await pedidos.locator("tbody tr").count(),7);
    await pagina.getByRole("button",{name:"Visão geral",exact:true}).click();
    await area.getByRole("button",{name:"Ver produtos ativos nesta página"}).click();
    assert.equal(await pagina.getByLabel("Somente ativos nesta página").isChecked(),true);
    await pagina.locator("#pagina").getByText("Página 1",{exact:true}).waitFor();
    await pagina.getByRole("button",{name:"Visão geral",exact:true}).click();
    await area.getByLabel("Período",{exact:true}).selectOption("personalizado");
    await area.getByLabel("De",{exact:true}).fill("2026-11-01");
    await area.getByLabel("Até",{exact:true}).fill("2026-11-02");
    await area.getByRole("button",{name:"Consultar"}).click();
    await area.getByRole("status").getByText(/Sem pedidos ou recebimentos/).waitFor();
    assert.equal(await tabela.locator("tbody tr").count(),2);
    assert.match(await tabela.locator("tbody").textContent(),/R\$\s*0,00/);
    await area.getByLabel("De",{exact:true}).fill("2023-11-01");
    await area.getByRole("button",{name:"Consultar"}).click();
    await area.getByRole("status").getByText(/até 366 dias/).waitFor();
    assert.equal(await tabela.isVisible(),false);
  }finally{servidor.close();await navegador.close();}
});
