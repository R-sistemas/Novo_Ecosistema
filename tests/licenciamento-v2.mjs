import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import api from "../api/mercado-pago-empresa.mjs";

const require = createRequire(import.meta.url);
const id = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const central = id(1), gestor = id(2), outro = id(3);
const legado = id(11), loja = id(12), encerrada = id(13), expirada = id(14), suspensa = id(15), cartao = id(16);
const requisicao = id(21), agendada = id(17), alteravel = id(18);
const migration = (name) => readFile(new URL("../supabase/migrations/" + name + ".sql", import.meta.url), "utf8");

test("licenciamento v2 em banco descartável", async (t) => {
  const { PGlite } = require(process.env.PAINEL_PGLITE_MODULE || "@electric-sql/pglite");
  const db = new PGlite();
  t.after(() => db.close());
  const scalar = async (sql, params) => (await db.query(sql, params)).rows[0]?.resultado;
  const aplicar = async (name) => db.exec(await migration(name));
  const sessao = async (sub, aal = "aal1", recente = true) => {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub, aal, amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - (recente ? 0 : 900) }]
    })]);
  };

  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select current_setting('request.jwt.claims',true)::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
  `);
  await aplicar("202611050001_base_pdv");
  await db.exec("alter table public.empresas add column cardapio_slug text unique");
  for (const name of [
    "202611180047_painel_autorizacao", "202611180048_painel_auditoria",
    "202611210073_central_inventario_licenca", "202611210074_politica_suspensao_central"
  ]) await aplicar(name);
  for (const usuario of [central, gestor, outro]) await db.query("insert into auth.users values($1)", [usuario]);
  for (const empresa of [legado, loja, encerrada, expirada, suspensa, cartao, agendada, alteravel]) {
    await db.query("insert into public.empresas(id,nome) values($1,'Empresa de teste')", [empresa]);
    await db.query("insert into public.membros values($1,$2,'gestor')", [empresa, gestor]);
  }
  await db.query("insert into painel_privado.vinculos_centrais values($1,'central')", [central]);
  await db.query(`insert into painel_privado.central_licencas values($1,'ativa','basico',9000,'2027-03-05','pago',9)`, [legado]);
  for (const name of [
    "202611270101_licenciamento_validade_base", "202611270102_licenciamento_calendario_portas",
    "202611270103_licenciamento_cobrancas_pix", "202611270104_licenciamento_avisos_retencao",
    "202611270106_licenciamento_catalogo_vigente", "202611270107_licenciamento_cartao_sandbox",
    "202611270108_licenciamento_agenda_pix", "202611270109_licenciamento_conciliacao_ativa",
    "202611270110_licenciamento_mudancas_programadas"
  ]) await aplicar(name);

  const iniciar = (empresa, cnpj, chave) => scalar(
    "select public.central_iniciar_trial_licenca($1,$2,$3) resultado", [empresa, cnpj, chave]
  );
  await t.test("expansão privada, flags desligadas, paridade do legado e calendário", async () => {
    assert.equal(await scalar(`select not (admissao_ativa or cobranca_ativa or avisos_ativos or exclusao_ativa or agenda_ativa or conciliacao_ativa or mudancas_ativas)
      resultado from licenciamento_privado.configuracao`), true);
    assert.equal(await scalar(`select not has_schema_privilege('authenticated','licenciamento_privado','USAGE') resultado`), true);
    assert.deepEqual(await scalar(`select jsonb_build_array(c.politica,c.ancora_dia,l.preco_centavos,l.revisao,l.pagamento,
      l.vencimento,s.efetivo) resultado from licenciamento_privado.contratos c
      join painel_privado.central_licencas l using(empresa_id)
      cross join lateral painel_privado.situacao_empresa(l.empresa_id) s where c.empresa_id=$1`, [legado]),
    ["legado_dia5", 5, 9000, 9, "pago", "2027-03-05", "em_dia"]);
    assert.deepEqual(await scalar(`select jsonb_build_array(
      licenciamento_privado.data_aniversario('2028-01-31',31::smallint,1),
      licenciamento_privado.data_aniversario('2028-02-29',31::smallint,1),
      licenciamento_privado.data_aniversario('2027-10-31',31::smallint,6),
      licenciamento_privado.data_aniversario('2027-01-31',31::smallint,1),
      licenciamento_privado.cnpj_canonico('12.ABC.345/01DE-35')) resultado`),
    ["2028-02-29", "2028-03-31", "2028-04-30", "2027-02-28", "12ABC34501DE35"]);
  });

  let oferta;
  await t.test("trial com MFA, 168h, replay e CNPJ único", async () => {
    await sessao(central, "aal2");
    await assert.rejects(iniciar(loja, "12345678000195", requisicao), { code: "42501" });
    await db.exec("update licenciamento_privado.configuracao set admissao_ativa=true");
    await sessao(central);
    await assert.rejects(iniciar(loja, "12345678000195", requisicao), { code: "42501" });
    await sessao(central, "aal2");
    const trial = await iniciar(loja, "12.345.678/0001-95", requisicao);
    assert.equal(Date.parse(trial.trial_fim) - Date.parse(trial.trial_inicio), 168 * 3600 * 1000);
    assert.deepEqual(await iniciar(loja, "12345678000195", requisicao), trial);
    await assert.rejects(iniciar(encerrada, "12345678000195", id(22)), { code: "23505" });
    await iniciar(encerrada, "12.ABC.345/01DE-35", id(22));
    await db.query(`insert into licenciamento_privado.contratos(empresa_id,politica,fase,trial_inicio,trial_fim)
      values($1,'aniversario','trial',statement_timestamp(),statement_timestamp()+interval '168 hours')`,[cartao]);
    oferta = await scalar(`select public.central_licenca_publicar_oferta('basico',1,6::smallint,60000,1250,'termos-v1') resultado`);
  });

  await t.test("Pix semestral isola recebedor e valor, aplica vigência uma vez e invalida estorno integral", async () => {
    const reservar = (usuario, chave) => scalar(`select public.servico_licenca_reservar_pix(
      $1,$2,$3,'termos-v1',$4,'mercado_pago','sandbox-teste','sandbox') resultado`, [loja, usuario, oferta, chave]);
    await assert.rejects(reservar(gestor, id(31)), { code: "42501" });
    await db.exec("update licenciamento_privado.configuracao set cobranca_ativa=true, avisos_ativos=true");
    await scalar("select public.servico_licenca_manutencao() resultado");
    assert.equal(await scalar("select count(*)::int resultado from licenciamento_privado.avisos where empresa_id=$1", [loja]), 6);
    await assert.rejects(reservar(outro, id(31)), { code: "42501" });
    const cobranca = await reservar(gestor, id(31));
    assert.equal(cobranca.valor_centavos, 52500);
    assert.deepEqual(await reservar(gestor, id(31)), cobranca);
    await assert.rejects(reservar(gestor, id(32)), { code: "23505" });
    const evento = (tipo, chave, recebedor = "sandbox-teste", valor = cobranca.valor_centavos) => scalar(
      `select public.servico_licenca_evento($1,'mercado_pago',$2,'sandbox','ORDTSTSIMULADA',
        $3,$4,$5,statement_timestamp()) resultado`, [cobranca.id, recebedor, valor, chave, tipo]
    );
    await sessao(gestor);
    const retomar = await scalar("select public.loja_licenca_resumo($1) resultado", [loja]);
    assert.equal(retomar.historico[0].retomar.requisicao, id(31));
    await sessao(outro);
    await assert.rejects(scalar("select public.loja_licenca_resumo($1) resultado", [loja]), {code:"42501"});
    await sessao(central, "aal2");
    const novaOferta = await scalar(`select public.central_licenca_publicar_oferta(
      'basico',2,6::smallint,61000,null,'termos-v2') resultado`);
    assert.equal(await scalar("select id resultado from licenciamento_privado.ofertas where comercializavel"), novaOferta);
    assert.deepEqual(await reservar(gestor, id(31)), cobranca);
    assert.equal(await evento("pago", "pago", "outra-conta"), "ignorado");
    assert.equal(await evento("pago", "pago", "sandbox-teste", 100), "ignorado");
    assert.equal(await evento("pago", "pago"), "confirmado");
    assert.equal(await evento("pago", "pago"), "confirmado");
    await scalar("select public.servico_licenca_manutencao() resultado");
    assert.equal(await scalar(`select count(*)::int resultado from licenciamento_privado.avisos
      where empresa_id=$1 and marco like 'trial_%' and cancelado_em is not null`, [loja]), 6);
    assert.equal(await evento("parcial", "parcial"), "confirmado");
    assert.equal(await evento("estornado", "integral"), "estornado");
    assert.equal(await scalar("select efetivo resultado from painel_privado.situacao_empresa($1)", [loja]), "bloqueada_total");
  });

  await t.test("tolerância de licença paga termina em D+5 e inicia retenção de 90 dias", async () => {
    await db.query(`insert into licenciamento_privado.contratos(empresa_id,politica,fase,oferta_id,ancora_dia,valido_ate)
      values($1,'aniversario','ativa',$2,31,'2020-01-31')`, [suspensa, oferta]);
    const estado = (data) => scalar(`select licenciamento_privado.estado_operacional(c,$2::timestamptz) resultado
      from licenciamento_privado.contratos c where empresa_id=$1`, [suspensa, data]);
    assert.equal(await estado("2020-02-05T02:59:59Z"), "tolerancia");
    assert.equal(await estado("2020-02-05T03:00:00Z"), "restrita");
    await scalar("select public.servico_licenca_manutencao() resultado");
    assert.equal(await scalar(`select extract(day from retencao_ate-acesso_encerrado_em)::int resultado
      from licenciamento_privado.contratos where empresa_id=$1`, [suspensa]), 90);
  });

  await t.test("cartão preserva cotação e confirma somente a condição aceita", async () => {
    await sessao(central,"aal2");
    const oferta = await scalar(`select id resultado from licenciamento_privado.ofertas where comercializavel and meses=6`);
    const q = {base:61000,total:68400,parcela:11400,vezes:6,bandeira:"master"};
    const reservar = (condicoes) => scalar(`select public.servico_licenca_reservar_cartao(
      $1,$2,$3,'termos-v2',$4,'mercado_pago','sandbox-teste','sandbox',$5) resultado`, [cartao,gestor,oferta,id(61),condicoes]);
    const c = await reservar(q);
    assert.equal(c.desconto_basis_points,0);
    assert.equal(c.meio,"cartao");
    assert.deepEqual(await reservar(q),c);
    await assert.rejects(reservar({...q,vezes:7}),{code:"23505"});
    const observar = (meio, condicoes) => scalar(`select public.servico_licenca_observar_ordem(
      $1,'mercado_pago','sandbox-teste','sandbox','ORDTSTCARTAO',61000,'cartao','pago',statement_timestamp(),$2,$3) resultado`,
      [c.id,meio,condicoes]);
    assert.equal(await observar("pix",{}),"ignorado");
    assert.equal(await observar("cartao",{...q,total:61000}),"ignorado");
    assert.equal(await observar("cartao",q),"confirmado");
    assert.equal(await observar("cartao",q),"confirmado");
  });

  await t.test("agenda Pix mensal começa em D−5 e reutiliza a mesma intenção após falha",async () => {
    await sessao(central,"aal2");
    const oferta = await scalar(`select public.central_licenca_publicar_oferta(
      'basico',1,1::smallint,10000,null,'mensal-v1') resultado`);
    await db.query(`insert into licenciamento_privado.contratos(empresa_id,politica,fase,oferta_id,ancora_dia,valido_ate)
      values($1,'aniversario','ativa',$2,5,(statement_timestamp() at time zone 'America/Sao_Paulo')::date+6)`,[agendada,oferta]);
    const puxar = () => scalar(`select public.servico_licenca_agendar_pix('sandbox-teste') resultado`);
    assert.equal(await puxar(),null);
    await db.exec("update licenciamento_privado.configuracao set agenda_ativa=true");
    assert.equal(await puxar(),null);
    await db.query("update licenciamento_privado.contratos set valido_ate=valido_ate-1 where empresa_id=$1",[agendada]);
    const item = await puxar();
    assert.equal(item.cobranca.empresa_id,agendada);
    assert.equal(item.cobranca.valor_centavos,10000);
    assert.equal(await puxar(),null);
    const fechar = (x,sucesso) => scalar("select public.servico_licenca_fechar_agenda($1,$2,$3) resultado",[x.id,x.lease,sucesso]);
    assert.equal(await fechar(item,false),true);
    await db.exec("update licenciamento_privado.agenda_pix set nova_tentativa_em=statement_timestamp()");
    const repetida = await puxar();
    assert.equal(repetida.cobranca.id,item.cobranca.id);
    assert.equal(await fechar(item,true),false);
    assert.equal(await fechar(repetida,true),true);
    assert.equal(await puxar(),null);
  });

  await t.test("conciliação usa conta privativa e reprocessa lease sem emitir outra cobrança",async () => {
    const puxar = (id) => scalar("select public.servico_licenca_puxar_conciliacao($1) resultado",[id]);
    assert.equal(await puxar("sandbox-teste"),null);
    await db.exec("update licenciamento_privado.configuracao set conciliacao_ativa=true");
    assert.equal(await puxar("recebedor-alheio"),null);
    const primeira = await puxar("sandbox-teste");
    assert.ok(primeira.consulta_lease);
    assert.equal(primeira.recebedor,"sandbox-teste");
    assert.equal(await scalar("select public.servico_licenca_fechar_conciliacao($1,$2,false) resultado",
      [primeira.id,id(911)]),false);
    assert.equal(await scalar("select public.servico_licenca_fechar_conciliacao($1,$2,false) resultado",
      [primeira.id,primeira.consulta_lease]),true);
    const espera = await scalar("select consultas_falhas resultado from licenciamento_privado.cobrancas where id=$1",[primeira.id]);
    assert.equal(espera,1);
    assert.equal(await scalar("select public.servico_licenca_ler_cobranca($1,$2,$3,$4) resultado",
      [primeira.empresa_id,outro,primeira.id,"sandbox-teste"]),null);
    assert.equal((await scalar("select public.servico_licenca_ler_cobranca($1,$2,$3,$4) resultado",
      [primeira.empresa_id,gestor,primeira.id,"sandbox-teste"])).id,primeira.id);
  });

  await t.test("mudança de plano exige pagamento e só altera o plano no vencimento",async () => {
    const mensal = await scalar("select id resultado from licenciamento_privado.ofertas where comercializavel and meses=1");
    const semestral = await scalar("select id resultado from licenciamento_privado.ofertas where comercializavel and meses=6");
    await db.query(`insert into licenciamento_privado.contratos(empresa_id,politica,fase,oferta_id,ancora_dia,valido_ate)
      values($1,'aniversario','ativa',$2,5,(statement_timestamp() at time zone 'America/Sao_Paulo')::date+3)`,[alteravel,mensal]);
    await sessao(gestor);
    const programar = () => scalar("select public.loja_licenca_programar_mudanca($1,$2,'termos-v2',$3) resultado",
      [alteravel,semestral,id(501)]);
    await assert.rejects(programar(),{code:"42501"});
    await db.exec("update licenciamento_privado.configuracao set mudancas_ativas=true");
    const mudanca = await programar();
    assert.deepEqual(await programar(),mudanca);
    assert.equal(mudanca.paga,false);
    const resumo = () => scalar("select public.loja_licenca_resumo($1) resultado",[alteravel]);
    assert.equal((await resumo()).oferta_atual,mensal);
    const reservar = (o,termo) => scalar(`select public.servico_licenca_reservar_pix(
      $1,$2,$3,$4,$5,'mercado_pago','sandbox-teste','sandbox') resultado`,[alteravel,gestor,o,termo,id(502)]);
    await assert.rejects(reservar(mensal,"mensal-v1"),{code:"23505"});
    const c = await reservar(semestral,"termos-v2");
    assert.equal(c.valor_centavos,61000);
    assert.equal(c.inicio_vigencia,mudanca.efetiva_em);
    assert.equal(await scalar(`select public.servico_licenca_evento($1,'mercado_pago','sandbox-teste','sandbox',
      'ORDTSTMUDANCA',61000,'mudanca','pago',statement_timestamp()) resultado`,[c.id]),"confirmado");
    assert.equal((await resumo()).oferta_atual,mensal);
    assert.equal((await resumo()).mudanca.paga,true);
    await db.query(`update licenciamento_privado.mudancas set efetiva_em=(statement_timestamp() at time zone 'America/Sao_Paulo')::date
      where empresa_id=$1`,[alteravel]);
    assert.equal((await resumo()).oferta_atual,semestral);
  });

  await t.test("saída voluntária exige sessão recente e ciência, corte e retenção idempotentes", async () => {
    const cancelar = (ciencia) => scalar(
      "select public.loja_licenca_cancelar($1,'trial',1,$2,$3) resultado", [encerrada, id(41), ciencia]
    );
    await sessao(gestor, "aal1", false);
    await assert.rejects(cancelar(true), { code: "42501" });
    await sessao(outro);
    await assert.rejects(cancelar(true), { code: "42501" });
    await sessao(gestor);
    await assert.rejects(cancelar(false), { code: "42501" });
    const recibo = await cancelar(true);
    assert.equal(recibo.registrado_em, recibo.efeito_em);
    assert.deepEqual(await cancelar(true), recibo);
    await db.query(`insert into licenciamento_privado.contratos(empresa_id,politica,fase,trial_inicio,trial_fim)
      values($1,'aniversario','trial',statement_timestamp()-interval '169 hours', statement_timestamp()-interval '1 hour')`, [expirada]);
    const estado = () => scalar("select efetivo resultado from painel_privado.situacao_empresa($1)", [expirada]);
    assert.equal(await estado(), "bloqueada_total");
    await db.exec("update licenciamento_privado.configuracao set exclusao_ativa=true");
    await scalar("select public.servico_licenca_manutencao() resultado");
    await scalar("select public.servico_licenca_manutencao() resultado");
    assert.equal(await scalar(`select count(*)::int resultado from licenciamento_privado.revisoes_exclusao
      where empresa_id in ($1,$2) and corte=elegivel_em and estado='avaliar_escopo'`, [encerrada, expirada]), 2);
    assert.equal(await scalar(`select not has_function_privilege('authenticated',
      'public.servico_licenca_manutencao()','EXECUTE') resultado`), true);
  });
});

test("webhook de licenças rejeita assinatura, modo e recebedor divergentes antes da RPC", async (t) => {
  const env = {
    SUPABASE_URL:"https://db.example.invalid", SUPABASE_SERVICE_ROLE_KEY:"service-simulado",
    LICENCAS_MP_SANDBOX_TOKEN:"TEST-fixture", LICENCAS_MP_SANDBOX_RECEBEDOR:"5555",
    LICENCAS_MP_SANDBOX_WEBHOOK_SECRET:"chave-sintetica"
  };
  const antes = Object.fromEntries(Object.keys(env).map(nome => [nome, process.env[nome]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [nome, v] of Object.entries(antes)) {
    if (v === undefined) delete process.env[nome];
    else process.env[nome] = v;
  }});
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const consultados = [];
  const recurso = "ORDTSTSIMULADO", request = "req-teste", ts = "1234567890";
  const v1 = createHmac("sha256", env.LICENCAS_MP_SANDBOX_WEBHOOK_SECRET)
    .update(`id:${recurso.toLowerCase()};request-id:${request};ts:${ts};`).digest("hex");
  const ordem = {
    id:recurso, collector_id:"5555", external_reference:id(91), total_amount:"50.00",
    currency_id:"BRL", status:"processed", status_detail:"accredited", last_updated_date:"2026-11-27T00:00:00Z",
    transactions:{payments:[{amount:"50.00",paid_amount:"50.00",status:"processed",payment_method:{id:"pix"}}]}
  };
  const eventos = [];
  globalThis.fetch = async (rota, opcoes) => {
    const {hostname,pathname} = new URL(rota);
    consultados.push(pathname);
    if (hostname === "api.mercadopago.com" && pathname === "/users/me") {
      return Response.json({id:5555,country_id:"BR",tags:["test_user"]});
    }
    if (hostname === "api.mercadopago.com" && pathname === "/v1/orders/" + recurso) return Response.json(ordem);
    if (hostname === "db.example.invalid" && pathname === "/rest/v1/rpc/servico_licenca_observar_ordem") {
      const dados = JSON.parse(opcoes.body);
      assert.equal(dados.p_recebedor,"5555");
      assert.equal(dados.p_tipo,"pago");
      assert.equal(dados.p_valor,5000);
      eventos.push(dados.p_evento);
      return Response.json("confirmado");
    }
    throw new Error("Endpoint imprevisto");
  };
  const chamar = async (assinatura) => {
    const res = {codigo:0,status(n){this.codigo=n;return this;},end(){}};
    await api({method:"POST",query:{operacao_mp:"licenca_webhook","data.id":recurso},
      headers:{"x-request-id":request,"x-signature":`ts=${ts},v1=${assinatura}`}},res);
    return res.codigo;
  };
  assert.equal(await chamar("0".repeat(64)),401);
  assert.deepEqual(consultados,[]);
  ordem.collector_id = "outra-conta";
  assert.equal(await chamar(v1),503);
  assert.equal(eventos.length,0);
  ordem.collector_id = "5555";
  ordem.live_mode = true;
  assert.equal(await chamar(v1),503);
  assert.equal(eventos.length,0);
  delete ordem.live_mode;
  assert.equal(await chamar(v1),200);
  assert.equal(await chamar(v1),200);
  assert.equal(eventos.length,2);
  assert.equal(eventos[0],eventos[1]);
});
