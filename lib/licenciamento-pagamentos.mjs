import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { assinaturaValida } from "./mercado-pago-webhook.mjs";
import { emailPixMercadoPago } from "./mercado-pago.mjs";
import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { adaptador, confirmar, provarConta } from "./licenciamento-ordens.mjs";

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
    const resultado = await obterPixLicenca(c,mp,recebedor);
    return resultado.estado === "ignorado" ? res.status(502).end() : res.status(200).json(resultado);
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

export async function obterPixLicenca(c,mp,recebedor) {
  if (c.estado !== "pendente") return {cobranca:c.id,estado:c.estado};
  const ordem = c.recurso ? await mp.consultarOrdem(c.recurso) : await mp.criarPix({
    pedidoId:c.id,totalCentavos:c.valor_centavos,email:emailPixMercadoPago(true),expiraEm:"PT30M"
  });
  if (ordem.external_reference !== c.id) throw new Error("Ordem não correlacionada");
  const estado = await confirmar(ordem,recebedor);
  return {cobranca:c.id,estado,valor_centavos:c.valor_centavos,
    pix:estado==="pendente" ? ordem.transactions?.payments?.[0]?.payment_method?.qr_code ?? null : null};
}
