import { createHmac, timingSafeEqual } from "node:crypto";
import { mercadoPago, pixMercadoPagoRecebido } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { MERCADO_PAGO_TEST_WEBHOOK_SECRET: segredo, MERCADO_PAGO_TEST_ACCESS_TOKEN: token } = process.env;
  if (!segredo || !token) return res.status(503).end();

  const id = req.query?.["data.id"];
  const requestId = req.headers["x-request-id"];
  const assinatura = req.headers["x-signature"];
  if (typeof id !== "string" || !/^[a-z0-9]{1,80}$/i.test(id) ||
      typeof requestId !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(requestId) ||
      typeof assinatura !== "string") {
    console.warn("Mercado Pago teste: metadados ausentes ou inválidos", {
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
    console.warn("Mercado Pago teste: formato da assinatura inválido");
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
    console.warn("Mercado Pago teste: assinatura divergente");
    return res.status(401).end();
  }

  if (!/^ORDTST[A-Z0-9]+$/i.test(id)) return res.status(200).end();
  try {
    const ordem = await mercadoPago(token).consultarOrdem(id.toUpperCase());
    console.info("Mercado Pago teste", id, ordem.status, ordem.status_detail);
    const pedidoId = ordem.external_reference;
    const totalCentavos = Math.round(Number(ordem.total_amount) * 100);
    if (ordem.id === id.toUpperCase() && typeof pedidoId === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(pedidoId) &&
        Number.isSafeInteger(totalCentavos) && totalCentavos > 0 &&
        pixMercadoPagoRecebido(ordem, { pedidoId, totalCentavos })) {
      const confirmado = await banco("atualizar_pix_mercado_pago_teste", {
        p_pedido: pedidoId, p_cobranca: ordem.id, p_valor: totalCentavos, p_confirmado: true
      });
      console.info("Mercado Pago teste: pedido confirmado", confirmado);
    }
    return res.status(200).end();
  } catch (erro) {
    console.error("Mercado Pago teste", erro.message);
    return res.status(502).end();
  }
}
