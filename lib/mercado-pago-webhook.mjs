import { createHmac, timingSafeEqual } from "node:crypto";
import { mercadoPago, pagamentoMercadoPagoRecebido, pixMercadoPagoRecebido } from "./mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "./banco-mercado-pago-teste.mjs";
import { conciliarOrdemPixFrente, referenciaPixFrente } from "./pix-frente-caixa.mjs";
import { ordemMercadoPago, registrarNotificacaoMercadoPago } from "./mercado-pago-eventos.mjs";
import { uuid } from "./painel-sessao.mjs";

function assinaturaValida(id, requestId, assinatura, segredo) {
  if (typeof id !== "string" || !/^[a-z0-9]{1,80}$/i.test(id) ||
      typeof requestId !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(requestId) ||
      typeof assinatura !== "string") return false;
  const campos = new URLSearchParams(assinatura.replaceAll(",", "&").replace(/\s/g, ""));
  const ts = campos.get("ts");
  const v1 = campos.get("v1");
  if (!/^\d{1,16}$/.test(ts ?? "") || !/^[a-f0-9]{64}$/i.test(v1 ?? "")) return false;
  const recebido = Buffer.from(v1,"hex");
  return [id.toLowerCase(),id].some(idAssinado => {
    const manifesto = "id:"+idAssinado+";request-id:"+requestId+";ts:"+ts+";";
    return timingSafeEqual(createHmac("sha256",segredo).update(manifesto).digest(),recebido);
  });
}

async function confirmarOrdem(ordem, sandbox) {
  const pedidoId = ordem.external_reference;
  const totalCentavos = Math.round(Number(ordem.total_amount) * 100);
  if (typeof pedidoId !== "string" || !uuid.test(pedidoId) ||
      !Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) return;
  const dados = { pedidoId, totalCentavos };
  const credito = pagamentoMercadoPagoRecebido(ordem,dados,"credit_card");
  if (!credito && !pixMercadoPagoRecebido(ordem,dados)) return;
  const atualizar = "atualizar_" + (credito ? "credito" : "pix") +
    "_mercado_pago_" + (sandbox ? "teste" : "quiosque");
  await banco(atualizar,{
    p_pedido:pedidoId, p_cobranca:ordem.id, p_valor:totalCentavos, p_confirmado:true
  });
}

export async function receberNotificacao(req, res, { segredo, token, sandbox }) {
  if (req.method !== "POST") return res.status(405).end();
  if (!segredo || !token) return res.status(503).end();
  const id = req.query?.["data.id"];
  if (!assinaturaValida(id,req.headers["x-request-id"],req.headers["x-signature"],segredo)) {
    console.warn("Mercado Pago: assinatura da notificação inválida");
    return res.status(401).end();
  }

  const cliente = mercadoPago(token);
  const ambiente = sandbox ? "sandbox" : "producao";
  if (!ordemMercadoPago(id)) {
    await registrarNotificacaoMercadoPago({cliente,payload:req.body,id,ambiente});
    return res.status(200).end();
  }
  if (/^ORDTST/i.test(id) !== sandbox) return res.status(200).end();

  const idOrdem = id.toUpperCase();
  try {
    const ordem = await cliente.consultarOrdem(idOrdem);
    if (referenciaPixFrente(ordem.external_reference)) {
      if (ordem.id !== idOrdem) throw new Error("ID da ordem Pix divergente.");
      await conciliarOrdemPixFrente(ordem,ambiente);
    } else if (ordem.id === idOrdem) {
      await confirmarOrdem(ordem,sandbox);
      await registrarNotificacaoMercadoPago({cliente,id:idOrdem,ambiente,ordem});
    }
    return res.status(200).end();
  } catch {
    console.error("Mercado Pago: falha no processamento da ordem", {ambiente});
    return res.status(502).end();
  }
}
