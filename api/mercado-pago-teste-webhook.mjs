import { createHmac, timingSafeEqual } from "node:crypto";
import { mercadoPago, pagamentoMercadoPagoRecebido, pixMercadoPagoRecebido } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";
import { conciliarOrdemPixFrente, referenciaPixFrente } from "../lib/pix-frente-caixa.mjs";

export async function receberNotificacao(req, res, { segredo, token, sandbox }) {
  if (req.method !== "POST") return res.status(405).end();
  if (!segredo || !token) return res.status(503).end();
  const log = sandbox ? "Mercado Pago teste" : "Mercado Pago Quiosque";

  const id = req.query?.["data.id"];
  const requestId = req.headers["x-request-id"];
  const assinatura = req.headers["x-signature"];
  if (typeof id !== "string" || !/^[a-z0-9]{1,80}$/i.test(id) ||
      typeof requestId !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(requestId) ||
      typeof assinatura !== "string") {
    console.warn(log + ": metadados ausentes ou inválidos", {
      idNaUrl: typeof id === "string",
      idNoCorpo: typeof req.body?.data?.id === "string",
      requestId: typeof requestId === "string",
      assinatura: typeof assinatura === "string"
    });
    return res.status(401).end();
  }

  const campos = new URLSearchParams(assinatura.replaceAll(",", "&").replace(/\s/g, ""));
  const ts = campos.get("ts");
  const v1 = campos.get("v1");
  if (!/^\d{1,16}$/.test(ts ?? "") || !/^[a-f0-9]{64}$/i.test(v1 ?? "")) {
    console.warn(log + ": formato da assinatura inválido");
    return res.status(401).end();
  }
  const recebido = Buffer.from(v1, "hex");
  const idsAssinados = [id.toLowerCase(), id];
  const valida = idsAssinados.some(idAssinado => {
    const manifesto = `id:${idAssinado};request-id:${requestId};ts:${ts};`;
    const esperado = createHmac("sha256", segredo).update(manifesto).digest();
    return timingSafeEqual(esperado, recebido);
  });
  if (!valida) {
    console.warn(log + ": assinatura divergente");
    return res.status(401).end();
  }

  if (!/^ORD[A-Z0-9]+$/i.test(id) || /^ORDTST/i.test(id) !== sandbox) return res.status(200).end();
  try {
    const ordem = await mercadoPago(token).consultarOrdem(id.toUpperCase());
    console.info(log, id, ordem.status, ordem.status_detail);
    const pedidoId = ordem.external_reference;
    if (referenciaPixFrente(pedidoId)) {
      if (ordem.id !== id.toUpperCase()) throw new Error("ID da ordem Pix divergente.");
      await conciliarOrdemPixFrente(ordem, sandbox ? "sandbox" : "producao");
      return res.status(200).end();
    }
    const totalCentavos = Math.round(Number(ordem.total_amount) * 100);
    const dados = { pedidoId, totalCentavos };
    const credito = pagamentoMercadoPagoRecebido(ordem, dados, "credit_card");
    if (ordem.id === id.toUpperCase() && typeof pedidoId === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(pedidoId) &&
        Number.isSafeInteger(totalCentavos) && totalCentavos > 0 &&
        (credito || pixMercadoPagoRecebido(ordem, dados))) {
      const atualizar = "atualizar_" + (credito ? "credito" : "pix") +
        "_mercado_pago_" + (sandbox ? "teste" : "quiosque");
      const confirmado = await banco(atualizar, {
        p_pedido: pedidoId, p_cobranca: ordem.id, p_valor: totalCentavos, p_confirmado: true
      });
      console.info(log + ": pedido confirmado", confirmado);
    }
    return res.status(200).end();
  } catch (erro) {
    console.error(log, erro.message);
    return res.status(502).end();
  }
}

export default function handler(req, res) {
  return receberNotificacao(req, res, {
    segredo: process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET,
    token: process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN,
    sandbox: true
  });
}
