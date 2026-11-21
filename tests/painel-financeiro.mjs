import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { before, after, test } from "node:test";
import handler from "../api/cadastrar-operador.mjs";

const require = createRequire(import.meta.url);
const {PGlite} = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname,"..");
const uid = n => "50000000-0000-0000-0000-" + String(n).padStart(12,"0");
const a = uid(101), b = uid(102), vazia = uid(103);
const usuarios = {a:uid(201),b:uid(202),op:uid(203)};
const dia = "2026-11-20", seguinte = "2026-11-21";
const config = JSON.parse(await readFile(resolve(root,"vercel.json"),"utf8"));

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
  const pasta = resolve(root,"supabase/migrations");
  for (const nome of (await readdir(pasta)).filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve(pasta,nome),"utf8"));
  }
  await db.exec(`
    insert into auth.users values ('${usuarios.a}','a@teste.invalid'),
      ('${usuarios.b}','b@teste.invalid'), ('${usuarios.op}','op@teste.invalid');
    insert into empresas(id,nome,cardapio_slug) values ('${a}','Loja A','a'),
      ('${b}','Loja B','b'), ('${vazia}','Vazia','vazia');
    insert into membros(empresa_id,usuario_id,papel) values
      ('${a}','${usuarios.a}','gestor'), ('${b}','${usuarios.b}','gestor'),
      ('${vazia}','${usuarios.a}','gestor'), ('${a}','${usuarios.op}','operador');
    insert into provedores_pagamento(empresa_id,provedor,ambiente) values
      ('${a}','mercado_pago','producao'), ('${a}','provedor_b','producao'),
      ('${a}','provedor_b','sandbox'), ('${b}','provedor_b','producao');
    insert into pedidos_online(id,empresa_id,cliente,itens,total_centavos,estado)
    select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      case when n=29 then '${b}' else '${a}' end::uuid, 'Cliente privado', '[]', 1000,
      case when n=2 then 'recusado' when n=3 then 'entregue' else 'novo' end
    from generate_series(1,30) n;
    insert into entregas_pedido(pedido_id,endereco,pagamento,frete_centavos)
      values ('${uid(3)}','{"telefone":"segredo"}','online',230);
    insert into cancelamentos_comanda(id,pedido_id,solicitado_por,motivo,estado)
      values ('${uid(91)}','${uid(4)}','${usuarios.a}','Teste','cancelado');
    insert into pagamentos_online(pedido_id,empresa_id,provedor,ambiente,meio,valor_centavos,cobranca_id,confirmado_em)
    select p.id,p.empresa_id,case when n<=13 then 'mercado_pago' else 'provedor_b' end,
      case when n=27 then 'sandbox' else 'producao' end,
      (array['pix','credito','debito'])[1+(n-1)%3], n*100,
      case when n<>30 then 'tx-'||n end,
      case when n=30 then null when n=28 then '2026-11-21 03:00+00'::timestamptz
        else '2026-11-21 02:00+00'::timestamptz end
    from generate_series(1,30) n
    join pedidos_online p on p.id=('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
  `);
});
after(() => db.close());

async function rpc(token, nome, args, papel = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec("set local role " + papel);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [usuarios[token] ?? "",papel]);
    const consulta = args.map((_,i) => "$" + (i+1)).join(",");
    return (await tx.query("select public." + nome + "(" + consulta + ") dados",args)).rows[0].dados;
  });
}
const resumo = (token,empresa,inicio=dia,fim=inicio) => rpc(token,"painel_financeiro_resumo",[empresa,inicio,fim]);
const extrato = (pagina,tamanho) => rpc("a","painel_financeiro_extrato",[a,dia,dia,pagina,tamanho]);

test("PGlite: produção confirmada, fuso civil, totais bigint, frete e provedores",async () => {
  const dados = await resumo("a",a);
  assert.equal(dados.quantidade,26);
  assert.equal(dados.total_centavos,"35100");
  assert.equal(dados.frete_centavos,"230");
  assert.equal(dados.taxa_centavos,null);
  assert.equal(dados.liquido_centavos,null);
  assert.deepEqual(dados.meios,{pix:"11700",credito:"12600",debito:"10800"});
  assert.deepEqual(dados.provedores,{mercado_pago:"9100",provedor_b:"26000"});
  assert.deepEqual(dados.canais,{cardapio:"34800",entrega:"300",pdv:"0"});
  assert.deepEqual(dados.dias,[{dia,total_centavos:"35100"}]);
  assert.equal((await resumo("a",a,seguinte)).total_centavos,"2800");
  assert.equal((await resumo("a",a,"2026-11-19",dia)).dias[0].total_centavos,"0");
  assert.equal((await resumo("a",vazia)).quantidade,0);
  assert.equal((await resumo("b",b)).total_centavos,"2900");
});

test("PGlite: isolamento, perfis, grants, limites e paginação estável sem PII",async () => {
  for (const [token,empresa] of [["a",b],["b",a],["op",a]]) {
    await assert.rejects(resumo(token,empresa),{code:"42501"});
    await assert.rejects(rpc(token,"painel_financeiro_extrato",[empresa,dia,dia,1,25]),{code:"42501"});
  }
  for (const papel of ["anon","service_role"]) {
    await assert.rejects(rpc("a","painel_financeiro_resumo",[a,dia,dia],papel),{code:"42501"});
  }
  await assert.rejects(resumo("a",a,"2024-01-01",dia),{code:"22023"});
  await assert.rejects(extrato(1,101),{code:"22023"});
  const [primeira,segunda] = [await extrato(1,25),await extrato(2,25)];
  assert.equal(primeira.tem_proxima,true);
  assert.equal(segunda.tem_proxima,false);
  const linhas = [...primeira.transacoes,...segunda.transacoes];
  assert.deepEqual(linhas.map(t => t.pedido_id),Array.from({length:26},(_,i) => uid(26-i)));
  assert.deepEqual(linhas.slice(-4).map(t => t.estado),["cancelado","entregue","recusado","pago"]);
  assert.deepEqual(Object.keys(linhas[0]).sort(),[
    "canal","confirmado_em","estado","frete_centavos","liquido_centavos","meio","pedido_id",
    "provedor","referencia","taxa_centavos","valor_centavos"
  ]);
  assert.equal(linhas[0].taxa_centavos,null);
  assert.equal(linhas[0].liquido_centavos,null);
  assert.deepEqual((await extrato(3,25)).transacoes,[]);
});

function simular(t) {
  process.env.SUPABASE_URL = "https://banco.example";
  process.env.SUPABASE_ANON_KEY = "fixture";
  let falhar = false;
  t.mock.method(globalThis,"fetch",async (url,init) => {
    const token = init.headers.Authorization?.split(" ")[1];
    if (!Object.hasOwn(usuarios,token)) return new Response(null,{status:401});
    const nome = new URL(url).pathname.split("/").at(-1);
    if (nome === "user") return Response.json({id:usuarios[token]});
    const p = JSON.parse(init.body);
    try {
      if (nome === "painel_contexto_sessao") return Response.json(await rpc(token,nome,[p.p_empresa_id]));
      if (nome === "painel_listar_produtos") return Response.json({produtos:[]});
      if (falhar) {
        falhar = false;
        return new Response(null,{status:502});
      }
      assert.match(nome,/^painel_financeiro_(resumo|extrato)$/);
      const args = [p.p_empresa,p.p_inicio,p.p_fim];
      if (nome.endsWith("extrato")) args.push(p.p_pagina,p.p_tamanho);
      return Response.json(await rpc(token,nome,args));
    } catch (erro) {
      const status = {42501:403,22023:400}[erro.code];
      if (!status) throw erro;
      return new Response(null,{status});
    }
  });
  return () => { falhar = true; };
}

async function api(caminho, authorization, method="GET") {
  const url = new URL(caminho,"http://localhost");
  const rewrite = config.rewrites.find(r => r.source === url.pathname);
  assert.ok(rewrite);
  const query = Object.fromEntries(url.searchParams);
  Object.assign(query,Object.fromEntries(new URL(rewrite.destination,url).searchParams));
  const resposta = {
    headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},
    json(d){this.body=d;},end(){}
  };
  await handler({query,method,headers:{authorization}},resposta);
  assert.equal(resposta.headers["Cache-Control"],"no-store");
  return resposta;
}

test("API: rota Vercel, sessão, autorização e validação de datas/página",async t => {
  simular(t);
  const path = "/api/painel-financeiro?" + new URLSearchParams({empresa_id:a,acao:"extrato",inicio:dia,fim:dia});
  assert.equal((await api(path,"Bearer a")).body.transacoes.length,25);
  assert.equal((await api(path + "&pagina=2","Bearer a")).body.transacoes.length,1);
  assert.equal((await api(path + "&pagina=0","Bearer a")).code,400);
  assert.equal((await api(path.replace("fim="+dia,"fim=2026-11-31"),"Bearer a")).code,400);
  assert.equal((await api(path.replace("inicio="+dia,"inicio=2025-01-01"),"Bearer a")).code,400);
  assert.equal((await api(path,"Bearer b")).code,403);
  assert.equal((await api(path,"Bearer op")).code,403);
  assert.equal((await api(path,"Bearer inválido")).code,401);
  assert.equal((await api(path)).code,401);
  assert.equal((await api(path,"Bearer a","POST")).code,405);
});

test("Chrome: área, filtros, provedor desconhecido, paginação, vazio, retry e mobile",{
  skip:!process.env.PAINEL_PLAYWRIGHT_MODULE || !process.env.PAINEL_CHROME_PATH
},async t => {
  const falhar = simular(t);
  const {chromium} = require(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({headless:true,executablePath:process.env.PAINEL_CHROME_PATH,
    args:["--disable-background-networking","--disable-component-update"]});
  const tipos = {".html":"text/html",".mjs":"text/javascript",".css":"text/css",".png":"image/png"};
  const servidor = createServer(async (req,res) => {
    try {
      const url = new URL(req.url,"http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const r = await api(req.url,req.headers.authorization);
        return res.writeHead(r.code,{"Content-Type":"application/json",...r.headers}).end(JSON.stringify(r.body));
      }
      const arquivo = resolve(root,"."+url.pathname);
      if (!arquivo.startsWith(root+sep)) return res.writeHead(403).end();
      const conteudo = await readFile(arquivo);
      res.writeHead(200,{"Content-Type":tipos[extname(arquivo)] ?? "application/octet-stream"}).end(conteudo);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });
  try {
    await new Promise(r => servidor.listen(0,"127.0.0.1",r));
    const pagina = await browser.newPage({viewport:{width:1366,height:950}});
    pagina.setDefaultTimeout(10000);
    const erros = [];
    pagina.on("pageerror",erro => erros.push(erro.message));
    await pagina.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async rota => {
      const {pathname} = new URL(rota.request().url());
      if (pathname === "/auth/v1/token") return rota.fulfill({json:{user:{id:usuarios.a},access_token:"a",refresh_token:"fixture",expires_in:3600}});
      if (pathname === "/rest/v1/membros") return rota.fulfill({json:[{empresas:{id:a,nome:"Loja A"}}]});
      return rota.abort();
    });
    await pagina.clock.setFixedTime(new Date("2026-11-20T15:00:00Z"));
    await pagina.goto("http://127.0.0.1:" + servidor.address().port + "/admin-loja.html");
    await pagina.getByLabel("E-mail",{exact:true}).fill("a@teste.invalid");
    await pagina.getByLabel("Senha",{exact:true}).fill("fixture");
    await pagina.getByRole("button",{name:"Entrar",exact:true}).click();
    await pagina.locator("#pagina").getByText("Página 1").waitFor();
    assert.equal(await pagina.locator("#lateral-painel nav button").count(),8);
    assert.equal(await pagina.locator("#aba-entregas + button").textContent(),"Financeiro");
    await pagina.locator("#aba-financeiro").click();
    const area = pagina.locator("#area-financeiro");
    const captura = async nome => {
      if (process.env.PAINEL_CAPTURAS) await pagina.screenshot({path:resolve(process.env.PAINEL_CAPTURAS,nome)});
    };
    await area.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await area.locator("tbody tr").count(),25);
    await area.locator("[data-provedores]").getByText("provedor_b",{exact:true}).waitFor();
    await captura("financeiro-desktop.png");
    await area.getByRole("button",{name:"Próxima"}).click();
    await area.getByText("Página 2",{exact:true}).waitFor();
    assert.equal(await area.locator("tbody tr").count(),1);
    assert.equal(await area.getByRole("button",{name:"Próxima"}).isDisabled(),true);

    const filtro = area.getByLabel("Período");
    await filtro.selectOption("7");
    await area.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await area.locator("[data-grafico] li").count(),7);
    await filtro.selectOption("30");
    await area.getByText("Página 1",{exact:true}).waitFor();
    assert.equal(await area.locator("[data-grafico] li").count(),30);
    await filtro.selectOption("personalizado");
    await area.getByLabel("Início").fill("2026-11-01");
    await area.getByLabel("Fim").fill("2026-11-02");
    await area.getByRole("button",{name:"Aplicar"}).click();
    await area.getByText("Sem recebimentos no período",{exact:true}).waitFor();

    falhar();
    await filtro.selectOption("hoje");
    await area.getByRole("button",{name:"Tentar novamente"}).click();
    await area.getByText("Página 1",{exact:true}).waitFor();
    await pagina.setViewportSize({width:390,height:844});
    await pagina.waitForFunction(() => document.querySelector("#lateral-painel").getBoundingClientRect().right <= 0);
    assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth),390);
    await captura("financeiro-mobile.png");
    await area.getByRole("heading",{name:"Extrato"}).scrollIntoViewIfNeeded();
    await captura("financeiro-mobile-extrato.png");
    assert.deepEqual(erros,[]);
  } finally {
    servidor.close();
    await browser.close();
  }
});
