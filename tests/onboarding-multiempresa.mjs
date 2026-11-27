import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import onboarding from "../central/api/central/onboarding.mjs";

const { PGlite } = createRequire(import.meta.url)(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
const banco = new PGlite();
const central = randomUUID(), titular = randomUUID(), outra = randomUUID(), novo = randomUUID();
const email = "gestor@example.invalid", emailNovo = "novo@example.invalid", emailLegado = "legado@example.invalid";
const reqLegado = randomUUID();
const central2 = [central,"aal2"];
const titular1 = [titular,"aal1"];

before(async () => {
  await banco.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to authenticated,anon,service_role;
    create table auth.users(id uuid primary key,email text unique,invited_at timestamptz,raw_user_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
  `);
  const pasta = new URL("../supabase/migrations/",import.meta.url);
  for (const nome of (await readdir(pasta)).filter(nome => nome.endsWith(".sql")).sort()) {
    await banco.exec(await readFile(new URL(nome,pasta),"utf8"));
  }
  await banco.query("insert into auth.users(id,email) values($1,'central@example.invalid'),($2,$3),($4,'outra@example.invalid')",
    [central,titular,email,outra]);
  await banco.query("insert into painel_privado.vinculos_centrais(usuario_id,papel) values($1,'central')",[central]);
});
after(() => banco.close());

async function como([usuario,aal], sql, parametros = []) {
  return banco.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:usuario,aal,role:"authenticated"})]);
    return (await tx.query(sql,parametros)).rows;
  });
}

const args = (slug, destinatario = email, chave = randomUUID()) =>
  [slug,slug,destinatario,"basico",1000,"2026-12-05","pendente",chave];
const provisao = async (dados, identidade = central2) => (await como(identidade,
  "select central_provisionar_empresa($1,$2,$3,$4,$5,$6,$7,$8) as r",dados))[0].r;
const aceitar = async (token, identidade = titular1, acao = "aceitar") => (await como(identidade,
  "select responder_convite_primeiro_gestor($1,$2) as r",[token,acao]))[0].r;
const ficha = async (empresa, acao = "listar", requisicao = null, identidade = central2) => (await como(identidade,
  "select central_convite_primeiro_gestor($1,$2,$3) as r",[empresa,acao,requisicao]))[0].r;
const vinculos = async usuario => (await banco.query("select empresa_id,papel from public.membros where usuario_id=$1 order by empresa_id",[usuario])).rows;
let legado, a, b;

test("reconhece o modo legado, cria intenção antiga e exige autoridade central com MFA", async () => {
  const dados = args("loja-legada",emailLegado,reqLegado);
  assert.deepEqual(await provisao(dados),{modo:"legado"});
  await assert.rejects(provisao(dados,[central,"aal1"]),{code:"42501"});
  await assert.rejects(provisao(dados,[titular,"aal2"]),{code:"42501"});
  legado = (await como(central2,"select central_criar_empresa($1,$2,$3,$4,$5,$6,$7,$8) as id",dados))[0].id;
  assert.equal((await ficha(legado)).convite,null);
});

test("mesmo titular aceita duas lojas, com idempotência e isolamento Central × lojas", async () => {
  await banco.query("select painel_privado.configurar_onboarding_multiempresa(true)");
  const dados = args("loja-gestor-a");
  a = await provisao(dados);
  assert.match(a.token,/^[a-f0-9]{64}$/);
  assert.deepEqual(await provisao(dados),{empresa:a.empresa,modo:"convite"});
  await assert.rejects(provisao(["Mudou",...dados.slice(1)]),{code:"23505"});
  await assert.rejects(provisao(args("loja-gestor-a")),{code:"23505"});
  const dadosB = args("loja-gestor-b");
  const tentativas = await Promise.all([provisao(dadosB),provisao(dadosB)]);
  assert.equal(tentativas[0].empresa,tentativas[1].empresa);
  assert.equal(tentativas.filter(resposta => resposta.token).length,1);
  b = tentativas.find(resposta => resposta.token);
  assert.notEqual(a.empresa,b.empresa);
  assert.deepEqual(await vinculos(titular),[]);
  assert.equal((await aceitar(a.token,titular1,"consultar")).estado,"pendente");
  await assert.rejects(aceitar(a.token,[outra,"aal1"]),{code:"42501"});
  await assert.rejects(como(titular1,"select responder_convite_equipe($1,'aceitar')",[a.token]),{code:"42501"});
  await assert.rejects(ficha(a.empresa,"listar",null,[titular,"aal2"]),{code:"42501"});
  await assert.rejects(ficha(a.empresa,"reenviar",randomUUID(),[central,"aal1"]),{code:"42501"});
  await assert.rejects(como(titular1,"select painel_contexto_sessao($1)",[b.empresa]),{code:"42501"});
  await aceitar(a.token);
  const recebido = await aceitar(b.token);
  assert.deepEqual(await aceitar(b.token),recebido);
  assert.deepEqual((await vinculos(titular)).map(x=>x.empresa_id).sort(),[a.empresa,b.empresa].sort());
  assert.ok((await vinculos(titular)).every(x=>x.papel==="gestor"));
  await assert.rejects(como([titular,"aal2"],"select painel_contexto_sessao(null::uuid)"),{code:"42501"});
  const {rows:[totais]} = await banco.query(`
    select (select count(*)::int from painel_privado.central_licencas where empresa_id=any($1)) licencas,
      (select count(*)::int from painel_privado.central_onboarding where empresa_id=any($1)) onboardings,
      (select count(*)::int from painel_privado.auditoria where empresa_id=any($1) and acao='central.convite_gestor.aceitar') aceites`,
    [[a.empresa,b.empresa]]);
  assert.deepEqual(totais,{licencas:2,onboardings:2,aceites:2});
});

test("conta nova, reenvio e legado em trânsito após o corte", async () => {
  const criado = await provisao(args("loja-novo-gestor",emailNovo));
  const requisicao = randomUUID();
  const reenvio = await ficha(criado.empresa,"reenviar",requisicao);
  assert.equal(reenvio.geracao,2);
  assert.deepEqual(await ficha(criado.empresa,"reenviar",requisicao),{geracao:2});
  assert.equal((await ficha(criado.empresa)).convite.historico.length,2);
  const {rows:[antigo]} = await banco.query("select chave from painel_privado.central_onboarding where empresa_id=$1",[legado]);
  const idLegado = randomUUID();
  await banco.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)",
    [idLegado,emailLegado,{rs_convite:antigo.chave},novo,emailNovo,{rs_convite:antigo.chave}]);
  await banco.query("update auth.users set invited_at=now() where id in ($1,$2)",[idLegado,novo]);
  await banco.query("update auth.users set invited_at=now() where id=$1",[idLegado]);
  assert.deepEqual(await vinculos(idLegado),[{empresa_id:legado,papel:"gestor"}]);
  assert.deepEqual(await vinculos(novo),[]);
  await assert.rejects(aceitar(criado.token,[novo,"aal1"]),{code:"42501"});
  assert.equal((await aceitar(reenvio.token,[novo,"aal1"])).estado,"aceito");
  assert.deepEqual(await vinculos(novo),[{empresa_id:criado.empresa,papel:"gestor"}]);
  await assert.rejects(como(central2,"select central_criar_empresa($1,$2,$3,$4,$5,$6,$7,$8)",
    args("legado-bloqueado","outronovo@example.invalid")),{code:"42501"});
  assert.equal((await como(central2,"select central_criar_empresa($1,$2,$3,$4,$5,$6,$7,$8) as id",
    args("loja-legada",emailLegado,reqLegado)))[0].id,legado);
});

test("API usa o token do agente e a pausa conserva os vínculos", async t => {
  const envAnterior = {url:process.env.SUPABASE_URL,chave:process.env.SUPABASE_ANON_KEY};
  process.env.SUPABASE_URL="https://fixture.example.invalid";
  process.env.SUPABASE_ANON_KEY="fixture";
  t.after(() => {
    for (const [nome,valor] of [["SUPABASE_URL",envAnterior.url],["SUPABASE_ANON_KEY",envAnterior.chave]]) {
      if (valor === undefined) delete process.env[nome]; else process.env[nome]=valor;
    }
  });
  t.mock.method(globalThis,"fetch",async (url,init) => {
    assert.equal(url.pathname,"/rest/v1/rpc/central_provisionar_empresa");
    assert.equal(init.headers.Authorization,"Bearer agente");
    return Response.json(await provisao(Object.values(JSON.parse(init.body))));
  });
  const entrada = args("loja-api");
  const corpo = Object.fromEntries(["nome","slug","email","plano","preco_centavos","vencimento","pagamento","requisicao"]
    .map((k,i)=>[k,entrada[i]]));
  const res = {setHeader(){},status(c){this.codigo=c;return this;},json(d){this.dados=d;}};
  await onboarding({headers:{authorization:"Bearer agente"},method:"POST",body:corpo},res);
  assert.equal(res.codigo,201);
  assert.match(res.dados.token,/^[a-f0-9]{64}$/);
  await banco.query("select painel_privado.configurar_onboarding_multiempresa(false)");
  await assert.rejects(aceitar(res.dados.token),{code:"42501"});
  await assert.rejects(provisao(args("loja-pausada")),{code:"42501"});
  assert.equal((await ficha(res.dados.empresa)).convite.reenvio_habilitado,false);
  assert.equal((await vinculos(titular)).length,2);
});



test("onboarding de trial começa no primeiro aceite e preserva a rota legada", async () => {
  const sql = "select central_provisionar_empresa_trial($1,$2,$3,$4,$5) as r";
  const dados = ["Ensaio trial", "ensaio-trial", email, "12.ABC.345/01DE-35", randomUUID()];
  await banco.query("select painel_privado.configurar_onboarding_multiempresa(true)");
  await assert.rejects(como(central2,sql,dados),{code:"42501"});
  await banco.exec("update licenciamento_privado.configuracao set admissao_ativa=true");
  await assert.rejects(como(titular1,sql,dados),{code:"42501"});
  const [{r: criado}] = await como(central2,sql,dados);
  const [{r: replay}] = await como(central2,sql,dados);
  assert.deepEqual(replay,{empresa:criado.empresa,modo:"convite"});
  await assert.rejects(como(central2,sql,["Outra","outra-trial",email,dados[3],randomUUID()]),{code:"23505"});
  const estado = async () => (await banco.query(`
    select c.fase, extract(epoch from c.trial_fim-c.trial_inicio)::int duracao, s.efetivo,
      exists(select 1 from painel_privado.central_licencas l where l.empresa_id=c.empresa_id) legado
    from licenciamento_privado.contratos c cross join lateral painel_privado.situacao_empresa(c.empresa_id) s
    where c.empresa_id=$1`,[criado.empresa])).rows[0];
  assert.deepEqual(await estado(),{fase:"preparacao",duracao:null,efetivo:"bloqueada_total",legado:false});
  await aceitar(criado.token);
  await aceitar(criado.token);
  assert.deepEqual(await estado(),{fase:"trial",duracao:604800,efetivo:"em_dia",legado:false});
});
