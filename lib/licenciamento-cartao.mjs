import { createHash } from "node:crypto";
import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { adaptador, centavos, condicoesCartao, confirmar, provarConta, provarOrdem } from "./licenciamento-ordens.mjs";

const bandeira = /^[a-z0-9_-]{1,40}$/i;
const chave = (id, operacao) => createHash("sha256").update(id + ":" + operacao).digest("hex").slice(0,32);

async function cotacoes(mp, bin, base) {
  const retornos = await mp.cotarParcelas(bin, base);
  return retornos.flatMap(item => {
    if (!bandeira.test(item.payment_method_id ?? "") ||
        (item.payment_type_id && item.payment_type_id !== "credit_card")) return [];
    return (item.payer_costs ?? []).flatMap(custo => {
      const {installments:vezes} = custo;
      const total = centavos(custo.total_amount), parcela = centavos(custo.installment_amount);
      if (!Number.isInteger(vezes) || vezes<1 || vezes>6 || !(parcela>0) ||
          (vezes===1 ? total!==base || parcela!==base : !(total>base) || !(custo.installment_rate>0))) return [];
      return [{base,total,parcela,vezes,bandeira:item.payment_method_id}];
    });
  });
}

async function contexto(req, empresa) {
  const token = req.headers.authorization;
  if (!/^Bearer [\w.-]+$/.test(token ?? "")) throw Object.assign(new Error(),{status:401});
  const chamar = chamarSupabasePainel(token);
  if (!chamar) throw new Error("Supabase indisponível");
  const sessao = await chamar("/auth/v1/user");
  if (!sessao.ok) throw Object.assign(new Error(),{status:sessao.status < 500 ? 401 : 503});
  const {id} = await sessao.json();
  if (!uuid.test(id ?? "")) throw Object.assign(new Error(),{status:401});
  const resposta = await chamar("/rest/v1/rpc/loja_licenca_resumo", {
    method:"POST",body:JSON.stringify({p_empresa:empresa})
  });
  if (!resposta.ok) throw Object.assign(new Error(),{status:resposta.status});
  const resumo = await resposta.json();
  if (!resumo?.cobranca_ativa) throw Object.assign(new Error(),{status:403});
  return {id,resumo};
}

async function processarCartao(mp, recebedor, c, token, email) {
  const valor = (c.valor_centavos / 100).toFixed(2);
  let ordem = c.recurso ? await mp.consultarOrdem(c.recurso) : await mp.criarOrdemManual(c.id, valor, email);
  const id = ordem.id;
  const conferir = () => {
    provarOrdem(ordem, recebedor, c.recurso ?? id, c.id);
    if (ordem.processing_mode !== "manual" || ordem.total_amount !== valor) throw new Error("Ordem incompatível");
  };
  conferir();
  const inicial = await confirmar(ordem, recebedor);
  if (inicial !== "pendente") return inicial;
  if (ordem.status !== "created") return "pendente";
  const q = c.condicoes;
  if (!ordem.transactions?.payments?.length) {
    await mp.adicionarCartao(id,chave(c.id,"cartao"),valor,{
      id:q.bandeira,type:"credit_card",token,installments:q.vezes
    });
    ordem = await mp.consultarOrdem(id);
    conferir();
  }
  if (ordem.status !== "created") return confirmar(ordem, recebedor);
  const p = ordem.transactions?.payments?.[0];
  if (ordem.transactions?.payments?.length !== 1 || p.status !== "created" || p.amount !== valor ||
      p.payment_method?.type !== "credit_card" ||
      JSON.stringify(condicoesCartao(p,q.base,q.total)) !== JSON.stringify(
        {base:q.base,total:q.total,parcela:q.parcela,vezes:q.vezes,bandeira:q.bandeira})) {
    throw Object.assign(new Error("Condições do cartão divergentes"),{status:409});
  }
  try { await mp.processarOrdem(id,chave(c.id,"processar")); }
  catch (e) { if (![402,409,423].includes(e.status)) throw e; }
  ordem = await mp.consultarOrdem(id);
  conferir();
  return confirmar(ordem, recebedor);
}

export async function licenciamentoCartao(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "POST") return res.status(405).end();
  const {acao,empresa,oferta,termos,bin,requisicao,token,condicoes} = req.body ?? {};
  if (!uuid.test(empresa ?? "") || !["config","cotar","pagar"].includes(acao)) return res.status(400).end();
  try {
    const {id:gestor,resumo} = await contexto(req,empresa);
    const {LICENCAS_MP_SANDBOX_PUBLIC_KEY:publica,LICENCAS_MP_SANDBOX_PAYER:email} = process.env;
    if (!/^(TEST|APP_USR)-[a-z0-9_-]+$/i.test(publica ?? "") ||
        !/^(test_payer@example\.com|test_user_\d+@testuser\.com)$/i.test(email ?? "")) {
      return res.status(503).end();
    }
    const {mp,recebedor} = adaptador();
    await provarConta(mp,recebedor);
    if (acao === "config") return res.status(200).json({publica,email});
    if (typeof oferta !== "string" || !uuid.test(oferta) || typeof termos !== "string" ||
        typeof bin !== "string" || !/^\d{6}(?:\d{2})?$/.test(bin)) return res.status(400).end();
    const atual = resumo.ofertas.find(o => o.id===oferta && o.meses===6 && o.termos_versao===termos);
    if (!atual) return res.status(409).end();
    const opcoes = await cotacoes(mp,bin,atual.preco_centavos);
    if (acao === "cotar") return res.status(200).json({opcoes});
    if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(token) ||
        typeof requisicao !== "string" || !uuid.test(requisicao)) return res.status(400).end();
    const q = opcoes.find(x => Object.keys(x).every(k => x[k]===condicoes?.[k]));
    if (!q) return res.status(409).end();
    const c = await servico("servico_licenca_reservar_cartao",{
      p_empresa:empresa,p_gestor:gestor,p_oferta:oferta,p_termos:termos,p_requisicao:requisicao,
      p_provedor:"mercado_pago",p_recebedor:recebedor,p_ambiente:"sandbox",p_condicoes:q
    });
    const estado = c.estado === "pendente" ? await processarCartao(mp,recebedor,c,token,email) : c.estado;
    if (estado === "ignorado") return res.status(409).end();
    return res.status(200).json({cobranca:c.id,estado});
  } catch (e) {
    return res.status(({42501:403,22023:400,23505:409,P0002:404})[e.codigo] ??
      ([400,401,403,409].includes(e.status) ? e.status : 503)).end();
  }
}
