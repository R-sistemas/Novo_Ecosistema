import { createHash } from "node:crypto";
import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { contaDaOrdemMP, ordemNoAmbienteMP } from "./mercado-pago-ambiente.mjs";
import { assinaturaValida } from "./mercado-pago-webhook.mjs";
import { emailPixMercadoPago, mercadoPago } from "./mercado-pago.mjs";
import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";

function adaptador() {
  const { LICENCAS_MP_SANDBOX_TOKEN: token, LICENCAS_MP_SANDBOX_RECEBEDOR: recebedor,
    LICENCAS_MP_SANDBOX_WEBHOOK_SECRET: segredo } = process.env;
  if (!/^(TEST|APP_USR)-[a-z0-9_-]+$/i.test(token ?? "") || !/^\d+$/.test(recebedor ?? "")) {
    throw new Error("Adaptador sandbox indisponível");
  }
  return { mp: mercadoPago(token), recebedor, segredo };
}

const estados = new Map([
  ["processed:accredited","pago"],["processed:partially_refunded","parcial"],
  ["refunded:refunded","estornado"],["canceled:canceled","encerrado"],
  ["canceled:expired","encerrado"],["expired:expired","encerrado"]
]);

function validarOrdem(ordem, recebedor) {
  if (!ordemNoAmbienteMP(ordem, true, recebedor) ||
    String(contaDaOrdemMP(ordem) ?? "") !== recebedor ||
    !/^ORDTST/i.test(ordem.id) || !uuid.test(ordem.external_reference ?? "") ||
    (ordem.currency_id ?? ordem.currency ?? "BRL") !== "BRL") return null;
  const [pix] = ordem.transactions?.payments ?? [];
  if (!pix || ordem.transactions.payments.length !== 1 || pix.payment_method?.id !== "pix" ||
    pix.amount !== ordem.total_amount || !/^\d{1,8}\.\d{2}$/.test(pix.amount)) return null;
  const tipo = estados.get(ordem.status + ":" + ordem.status_detail) ?? "vinculo";
  if (tipo === "pago" && (pix.status !== "processed" || pix.amount !== pix.paid_amount)) return null;
  const data = ordem.last_updated_date ?? ordem.created_date;
  if (!data || !Number.isFinite(Date.parse(data))) return null;
  return { p_id: ordem.external_reference, p_provedor: "mercado_pago", p_recebedor: recebedor,
    p_ambiente: "sandbox", p_recurso: ordem.id, p_valor: Number(pix.amount.replace(".", "")),
    p_evento: createHash("sha256").update(JSON.stringify([ordem.id, tipo, data])).digest("hex"),
    p_tipo: tipo, p_ocorrido: data };
}

async function confirmar(ordem, recebedor) {
  const evento = validarOrdem(ordem, recebedor);
  if (!evento) throw new Error("Ordem não correlacionada");
  return servico("servico_licenca_evento", evento);
}

async function provarConta(mp, recebedor) {
  const conta = await mp.consultarConta();
  if (String(conta.id) !== recebedor || conta.country_id !== "BR" || !conta.tags?.includes("test_user")) {
    throw new Error("Recebedor fora do sandbox");
  }
}

export async function licenciamentoPix(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const token = req.headers.authorization;
  if (!/^Bearer [\w.-]+$/.test(token ?? "")) return res.status(401).end();
  const { empresa, oferta, termos, requisicao } = req.body ?? {};
  if (![empresa, oferta, requisicao].every(x => typeof x === "string" && uuid.test(x)) ||
    typeof termos !== "string" || termos.length < 1 || termos.length > 80) return res.status(400).end();
  try {
    const chamar = chamarSupabasePainel(token);
    if (!chamar) return res.status(503).end();
    const sessao = await chamar("/auth/v1/user");
    if (!sessao.ok) return res.status(sessao.status < 500 ? 401 : 503).end();
    const { id: gestor } = await sessao.json();
    if (!uuid.test(gestor ?? "")) return res.status(401).end();
    const { mp, recebedor } = adaptador();
    const c = await servico("servico_licenca_reservar_pix", { p_empresa: empresa, p_gestor: gestor, p_oferta: oferta,
      p_termos: termos, p_requisicao: requisicao, p_provedor: "mercado_pago", p_recebedor: recebedor, p_ambiente: "sandbox" });
    if (c.estado !== "pendente") return res.status(200).json({ cobranca: c.id, estado: c.estado });
    await provarConta(mp, recebedor);
    const ordem = c.recurso ? await mp.consultarOrdem(c.recurso) : await mp.criarPix({
      pedidoId: c.id, totalCentavos: c.valor_centavos, email: emailPixMercadoPago(true), expiraEm: "PT30M"
    });
    if (ordem.external_reference !== c.id) return res.status(502).end();
    const estado = await confirmar(ordem, recebedor);
    if (estado === "ignorado") return res.status(502).end();
    const meio = ordem.transactions?.payments?.[0]?.payment_method;
    return res.status(200).json({ cobranca: c.id, estado, valor_centavos: c.valor_centavos,
      pix: estado === "pendente" ? meio?.qr_code ?? null : null });
  } catch (e) {
    return res.status(({ "42501": 403, "22023": 400, "23505": 409, P0002: 404 })[e.codigo] ?? 503).end();
  }
}

export async function webhookLicenciamento(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { mp, recebedor, segredo } = adaptador();
    if (!segredo) return res.status(503).end();
    const id = req.query?.["data.id"];
    if (!assinaturaValida(id, req.headers["x-request-id"], req.headers["x-signature"], segredo)) return res.status(401).end();
    if (!/^ORDTST[a-z0-9]+$/i.test(id)) return res.status(200).end();
    await provarConta(mp, recebedor);
    const ordem = await mp.consultarOrdem(id.toUpperCase());
    if (ordem.id !== id.toUpperCase()) return res.status(502).end();
    await confirmar(ordem, recebedor);
    return res.status(200).end();
  } catch {
    return res.status(503).end();
  }
}
