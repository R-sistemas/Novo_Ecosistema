import { createHash, timingSafeEqual } from "node:crypto";
import { integracaoQuiosque, pedidoValido, pixRecebido } from "../lib/asaas-quiosque.mjs";

const hash = valor => createHash("sha256").update(valor).digest();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const token = process.env.ASAAS_QUIOSQUE_PRODUCTION_WEBHOOK_TOKEN;
  const integracao = integracaoQuiosque();
  if (!token || !integracao) return res.status(503).end();
  const recebido = req.headers["asaas-access-token"];
  if (typeof recebido !== "string" || !timingSafeEqual(hash(recebido), hash(token))) {
    return res.status(401).end();
  }
  const { event, payment } = req.body ?? {};
  if (event !== "PAYMENT_RECEIVED" || !pedidoValido(payment?.externalReference)) return res.status(200).end();
  if (typeof payment.id !== "string" || !/^pay_[a-z0-9]+$/i.test(payment.id)) return res.status(400).end();
  try {
    const cobranca = await integracao.asaas("/payments/" + encodeURIComponent(payment.id));
    const centavos = Math.round(cobranca.value * 100);
    if (cobranca.id !== payment.id || cobranca.externalReference !== payment.externalReference ||
        !Number.isSafeInteger(centavos) || centavos <= 0) return res.status(400).end();
    if (!pixRecebido(cobranca)) return res.status(200).end();
    await integracao.banco("atualizar_pix_quiosque", {
      p_pedido: cobranca.externalReference, p_cobranca: cobranca.id,
      p_valor: centavos, p_confirmado: true
    });
    return res.status(200).end();
  } catch (erro) {
    console.error("Webhook Pix Quiosque", erro.message);
    return res.status(503).end();
  }
}
