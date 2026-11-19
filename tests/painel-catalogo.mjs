import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve, sep, extname } from "node:path";
import { before, after, test } from "node:test";
import handler from "../api/cadastrar-operador.mjs";
import { entrar } from "../supabase-pdv.mjs";
import { atualizarProduto } from "../pdv/dados/catalogo.mjs";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname, "..");
const lojaA = "30000000-0000-0000-0000-00000000000a";
const lojaB = "30000000-0000-0000-0000-00000000000b";
const gestores = { a: "40000000-0000-0000-0000-000000000001", b: "40000000-0000-0000-0000-000000000002",
  operador: "40000000-0000-0000-0000-000000000003" };
const itemA = "50000000-0000-0000-0000-000000000001";
const itemB = "50000000-0000-0000-0000-000000000002";
const venda = "60000000-0000-0000-0000-000000000001";
const pedido = "60000000-0000-0000-0000-000000000002";
const read = path => readFile(resolve(root, path), "utf8");
const config = JSON.parse(await read("vercel.json"));

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
  const caminho = resolve(root, "supabase/migrations");
  for (const nome of (await readdir(caminho)).filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve(caminho, nome), "utf8"));
  }
  for (const [email,id] of Object.entries(gestores)) {
    await db.query("insert into auth.users values ($1,$2)", [id, email + "@example.invalid"]);
  }
  await db.query("insert into empresas (id,nome,cardapio_slug) values ($1,'A','a'),($2,'B','b')", [lojaA,lojaB]);
  await db.query("insert into membros values ($1,$3,'gestor'),($2,$4,'gestor'),($1,$5,'operador')",
    [lojaA,lojaB,gestores.a,gestores.b,gestores.operador]);
  await db.query(`insert into produtos(id,empresa_id,codigo,nome,preco_centavos,ativo)
    values ($1,$3,'IA','Inicial A',900,false),($2,$4,'IB','Segredo B',1800,true)`, [itemA,itemB,lojaA,lojaB]);
  const { rows: [caixa] } = await db.query(`insert into caixas(empresa_id,operador_id,abertura_centavos)
    values ($1,$2,0) returning id`, [lojaA,gestores.a]);
  await db.query(`insert into vendas (id,caixa_id,empresa_id,total_centavos,meio)
    values ($1,$2,$3,900,'dinheiro')`, [venda,caixa.id,lojaA]);
  await db.query(`insert into itens_venda(venda_id,produto_id,nome,quantidade,preco_centavos)
    values ($1,$2,'Histórico',1,900)`, [venda,itemA]);
  await db.query(`insert into pedidos_online (id,empresa_id,cliente,itens,total_centavos)
    values ($1,$2,'Teste',$3::jsonb,900)`, [pedido,lojaA,JSON.stringify([{ produto_id:itemA, preco_centavos:900 }])]);
});
after(() => db.close());

async function como(token, sql, params, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec("set local role " + role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [gestores[token] ?? ""]);
    return tx.query(sql, params);
  });
}

const listar = (token, empresa, cursor = null, limite = 25) => como(token,
  "select painel_listar_produtos($1,$2,$3) as dados", [empresa,cursor,limite]);
const gravar = (token, empresa, id, dados) => como(token,
  "select painel_gravar_produto($1,$2,$3) as id", [empresa,id,JSON.stringify(dados)]);

async function supabase(url, init) {
  const token = init.headers.Authorization?.replace(/^Bearer /, "");
  if (!Object.hasOwn(gestores, token)) return new Response(null, { status: 401 });
  if (url.pathname === "/auth/v1/user") return Response.json({ id: gestores[token] });
  const dados = JSON.parse(init.body);
  try {
    if (url.pathname === "/rest/v1/produtos" && init.method === "PATCH") {
      await como(token, "update produtos set ativo=$1 where empresa_id=$2 and id=$3",
        [dados.ativo, url.searchParams.get("empresa_id").slice(3), url.searchParams.get("id").slice(3)]);
      return new Response(null, { status: 204 });
    }
    const rotas = {
      painel_listar_produtos: () => listar(token,dados.p_empresa_id,dados.p_cursor,dados.p_limite),
      painel_gravar_produto: () => gravar(token,dados.p_empresa_id,dados.p_produto_id,dados.p_dados),
      painel_contexto_sessao: () => como(token,"select painel_contexto_sessao($1) as dados",[dados.p_empresa_id])
    };
    const { rows: [row] } = await rotas[url.pathname.split("/").at(-1)]();
    return Response.json(row.dados ?? row.id);
  } catch (erro) {
    const status = { "42501":403, PT404:404, "22023":400, "23505":409 }[erro.code];
    if (!status) throw erro;
    return new Response(null, { status });
  }
}

async function requisitar(path, token, method = "GET", body) {
  const url = new URL(path,"http://localhost");
  const rewrite = config.rewrites.find(r => r.source === url.pathname);
  const destino = new URL(rewrite.destination,url);
  for (const [k,v] of url.searchParams) destino.searchParams.append(k,v);
  const query = {};
  for (const key of destino.searchParams.keys()) {
    const values = destino.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  const resp = { headers:{}, setHeader(k,v){this.headers[k]=v;},
    status(code){this.code=code;return this;}, json(data){this.data=data;}, end(){} };
  await handler({method,query,body,headers:token ? {authorization:"Bearer "+token} : {}},resp);
  assert.equal(resp.headers["Cache-Control"],"no-store");
  return resp;
}

function simularSupabase(t, fn = supabase) {
  process.env.SUPABASE_URL = "https://banco.example";
  process.env.SUPABASE_ANON_KEY = "simulada";
  t.mock.method(globalThis,"fetch",(url,init) => fn(new URL(url),init));
}
const caminho = empresa => "/api/painel-catalogo?empresa_id=" + empresa;
const trilha = id => db.query(`select * from painel_privado.auditoria where entidade_id=$1
  order by ocorrido_em,id`, [id]);

test("RPC e API isolam as lojas, negam operador e incluem inativos com cursor", async t => {
  simularSupabase(t);
  assert.equal((await requisitar(caminho(lojaA),null)).code,401);
  for (const [token,origem,destino] of [["a",lojaA,lojaB],["b",lojaB,lojaA]]) {
    assert.equal((await requisitar(caminho(origem),token)).code,200);
    assert.equal((await requisitar(caminho(destino),token)).code,403);
    assert.equal((await requisitar(caminho(destino),token,"POST",{dados:{nome:"Negado"}})).code,403);
    await assert.rejects(listar(token,destino),{code:"42501"});
    await assert.rejects(gravar(token,destino,null,{nome:"Negado"}),{code:"42501"});
  }
  assert.equal((await requisitar(caminho(lojaA),"operador")).code,403);
  assert.equal((await requisitar(caminho(lojaA),"operador","POST",{dados:{ativo:true}})).code,403);
  await assert.rejects(gravar("operador",lojaA,itemA,{ativo:true}),{code:"42501"});
  await assert.rejects(como("a","select painel_listar_produtos($1,null,25)",[lojaA],"anon"),{code:"42501"});
  assert.equal((await requisitar(caminho(lojaA),"a","POST",{produto_id:itemB,dados:{ativo:true}})).code,404);
  const dados = {codigo:"PAG",nome:"Página seguinte",preco_centavos:200};
  await gravar("a",lojaA,null,dados);
  const first = (await listar("a",lojaA,null,1)).rows[0].dados;
  assert.equal(first.produtos.length,1);
  assert.equal(first.proximo_cursor,first.produtos[0].id);
  const second = (await listar("a",lojaA,first.proximo_cursor,1)).rows[0].dados;
  assert.equal(second.produtos.length,1);
  assert.notEqual(second.produtos[0].id,first.produtos[0].id);
  assert.equal(second.proximo_cursor,null);
  assert.equal([...first.produtos,...second.produtos].find(p=>p.id===itemA).ativo,false);
  assert.equal(first.produtos.every(p=>p.empresa_id===lojaA),true);
});

test("mutação cria uma trilha redigida; reativação e PDV REST compartilham o trigger", async t => {
  simularSupabase(t, async (url,init) => {
    if (url.pathname === "/auth/v1/token") return Response.json({
      user:{id:gestores.a}, access_token:"a", refresh_token:"fixture", expires_in:3600
    });
    return supabase(url,init);
  });
  globalThis.document = {querySelector:() => ({content:"fixture"})};
  try {
    const dados = {codigo:"T",nome:"Privado 1",preco_centavos:1250,descricao:"Texto sigiloso de fixture"};
    const criada = await requisitar(caminho(lojaA),"a","POST",{dados});
    assert.equal(criada.code,200);
    const id = criada.data;
    const ins = (await trilha(id)).rows;
    assert.equal(ins.length,1);
    assert.equal(ins[0].acao,"produto.criar");
    assert.equal(ins[0].autor_id,gestores.a);
    assert.equal(ins[0].origem_autor,"usuario");
    assert.equal(ins[0].empresa_id,lojaA);
    assert.equal(ins[0].antes,null);
    assert.equal(ins[0].depois.preco_centavos,1250);
    assert.doesNotMatch(JSON.stringify(ins),/Privado 1|Texto sigiloso/);

    const editada = await requisitar(caminho(lojaA),"a","POST",{produto_id:id,dados:{preco_centavos:1300,ativo:false}});
    assert.equal(editada.code,200);
    assert.equal((await requisitar(caminho(lojaA),"a","POST",{produto_id:id,dados:{ativo:true}})).code,200);
    const linhas = (await trilha(id)).rows;
    assert.equal(linhas.length,3);
    assert.equal(linhas[1].acao,"produto.editar");
    assert.equal(linhas[1].antes.preco_centavos,1250);
    assert.equal(linhas[1].depois.preco_centavos,1300);
    assert.equal(linhas[2].antes.ativo,false);
    assert.equal(linhas[2].depois.ativo,true);

    await entrar("fixture","fixture");
    await atualizarProduto(lojaA,id,{ativo:false});
    const legado = (await trilha(id)).rows;
    assert.equal(legado.length,4);
    assert.equal(legado[3].autor_id,gestores.a);
    assert.equal(legado[3].depois.ativo,false);

    await db.query("delete from produtos where id=$1",[id]);
    const exclusao = (await trilha(id)).rows.at(-1);
    assert.equal(exclusao.acao,"produto.excluir");
    assert.equal(exclusao.origem_autor,"sistema");
    assert.equal(exclusao.antes.ativo,false);
    assert.equal(exclusao.depois,null);
  } finally {
    delete globalThis.document;
  }
});

test("auditoria e produto revertem juntos; histórico permanece e vitrine respeita a flag pública", async () => {
  await db.exec(`
    create function public.fixture_falha_auditoria() returns trigger language plpgsql as $$
    begin raise exception 'Falha injetada'; end $$;
    create trigger fixture_falha_auditoria before insert on painel_privado.auditoria
    for each row when ((new.depois->>'preco_centavos') = '666') execute function public.fixture_falha_auditoria();
  `);
  const antes = (await trilha(itemA)).rows.length;
  await assert.rejects(gravar("a",lojaA,itemA,{preco_centavos:666}),{code:"P0001"});
  const rollback = (await db.query("select preco_centavos from produtos where id=$1",[itemA])).rows[0];
  assert.equal(Number(rollback.preco_centavos),900);
  assert.equal((await trilha(itemA)).rows.length,antes);
  await gravar("a",lojaA,itemA,{preco_centavos:2000,ativo:true,visivel_cardapio:false,queridinho:true});
  const oculto = (await db.query("select ver_cardapio('a') as dados")).rows[0].dados;
  assert.equal(oculto.produtos.some(p=>p.id===itemA),false);
  await gravar("a",lojaA,itemA,{visivel_cardapio:true});
  const visivel = (await db.query("select ver_cardapio('a') as dados")).rows[0].dados;
  assert.equal(visivel.produtos.find(p=>p.id===itemA).queridinho,true);
  const vendaGravada = (await db.query("select preco_centavos from itens_venda where venda_id=$1",[venda])).rows[0];
  const pedidoGravado = (await db.query("select itens,total_centavos from pedidos_online where id=$1",[pedido])).rows[0];
  assert.equal(Number(vendaGravada.preco_centavos),900);
  assert.equal(Number(pedidoGravado.total_centavos),900);
  assert.equal(pedidoGravado.itens[0].preco_centavos,900);
});

test("navegador usa Auth, bloqueia URL de outra loja e edita/recarrega o produto próprio", {
  skip: !process.env.PAINEL_PLAYWRIGHT_MODULE || !process.env.PAINEL_CHROME_PATH
}, async t => {
  simularSupabase(t);
  const { chromium } = require(process.env.PAINEL_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({
    executablePath:process.env.PAINEL_CHROME_PATH,
    headless:true, args:["--disable-background-networking","--disable-component-update"]
  });
  const types = {".html":"text/html",".mjs":"text/javascript",".css":"text/css"};
  const server = createServer(async (req,res) => {
    try {
      const url = new URL(req.url,"http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString();
        const result = await requisitar(req.url,req.headers.authorization?.split(" ")[1],req.method,raw ? JSON.parse(raw) : undefined);
        res.writeHead(result.code,{"Content-Type":"application/json",...result.headers});
        res.end(JSON.stringify(result.data));
      } else {
        const file = resolve(root,"."+url.pathname);
        if (!file.startsWith(root+sep)) return res.writeHead(403).end();
        res.writeHead(200,{"Content-Type":types[extname(file)] ?? "text/plain"});
        res.end(await readFile(file));
      }
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  try {
    await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
    const page = await browser.newPage();
    const origin = "http://127.0.0.1:"+server.address().port;
    let acessosCatalogo = 0;
    page.on("request",request => { if (request.url().includes("/api/painel-catalogo")) acessosCatalogo++; });
    await page.route("https://eyqxxlcmxlilgogxdcoq.supabase.co/**",async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/auth/v1/token") {
        return route.fulfill({json:{user:{id:gestores.a},access_token:"a",refresh_token:"fixture",expires_in:3600}});
      }
      assert.equal(url.pathname,"/rest/v1/membros");
      return route.fulfill({json:[{empresas:{id:lojaA,nome:"A"}}]});
    });
    const login = async url => {
      await page.goto(origin+url);
      await page.getByLabel("E-mail").fill("gestor@example.invalid");
      await page.getByLabel("Senha").fill("fixture");
      await page.getByRole("button",{name:"Entrar"}).click();
    };
    await login("/admin-loja.html?empresa_id="+lojaB);
    await page.getByRole("alert").filter({hasText:"Somente gestores"}).waitFor();
    assert.equal(await page.locator("#catalogo").isVisible(),false);
    assert.equal(acessosCatalogo,0);
    await login("/admin-loja.html?empresa_id="+lojaA);
    await page.getByRole("cell",{name:"Inicial A",exact:true}).waitFor();
    assert.equal(await page.getByText("Segredo B").count(),0);
    await page.getByRole("button",{name:"Editar Inicial A"}).click();
    await page.getByText("Ativo no PDV",{exact:true}).uncheck();
    await page.getByRole("button",{name:"Salvar produto"}).click();
    await page.getByRole("row",{name:/Inicial A/}).getByRole("cell",{name:"Inativo",exact:true}).waitFor();
    await page.getByRole("button",{name:"Editar Inicial A"}).click();
    await page.getByText("Ativo no PDV",{exact:true}).check();
    await page.getByRole("button",{name:"Salvar produto"}).click();
    await page.getByRole("row",{name:/Inicial A/}).getByRole("cell",{name:"Ativo",exact:true}).waitFor();
    assert.ok(acessosCatalogo >= 5);
  } finally {
    server.close();
    await browser.close();
  }
});

test("TRUNCATE registra uma exclusão por produto com origem de serviço", async () => {
  const before = (await db.query("select id from produtos order by id")).rows;
  const seed = (await db.query("select count(*) as total from painel_privado.auditoria where acao='produto.excluir'")).rows[0];
  await db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
    await tx.exec("truncate public.produtos cascade");
  });
  const count = (await db.query("select count(*) as total from produtos")).rows[0];
  assert.equal(Number(count.total),0);
  const { rows } = await db.query(`select entidade_id,origem_autor,requisicao_id,antes,depois
    from painel_privado.auditoria where acao='produto.excluir' and origem_autor='servico'`);
  assert.equal(rows.length,before.length);
  assert.equal(new Set(rows.map(r=>r.requisicao_id)).size,1);
  assert.deepEqual(rows.map(r=>r.entidade_id).sort(),before.map(r=>r.id));
  assert.ok(rows.every(r=>r.antes && r.depois===null));
  const after = (await db.query("select count(*) as total from painel_privado.auditoria where acao='produto.excluir'")).rows[0];
  assert.equal(Number(after.total)-Number(seed.total),before.length);
});
