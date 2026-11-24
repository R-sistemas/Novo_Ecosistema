import { bancoMercadoPagoTeste as banco } from "./banco-mercado-pago-teste.mjs";
import { vincularOrdemMP } from "./reserva-pedido-mp.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mercadoPago, pagamentoMercadoPagoRecebido, pixMercadoPagoRecebido } from "./mercado-pago.mjs";
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

async function confirmarOrdem(ordem, sandbox, integracao) {
  const pedidoId = ordem.external_reference;
  const totalCentavos = Math.round(Number(ordem.total_amount) * 100);
  if (typeof pedidoId !== "string" || !uuid.test(pedidoId) ||
      !Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) return;
  const dados = { pedidoId, totalCentavos };
  const pagamentos = ordem.transactions?.payments;
  const metodo = pagamentos?.[0]?.payment_method;
  const credito = metodo?.type === "credit_card";
  const pix = metodo?.type === "bank_transfer" && metodo.id === "pix";
  const confirmado = credito ? pagamentoMercadoPagoRecebido(ordem,dados,"credit_card") : pixMercadoPagoRecebido(ordem,dados);
  if ((!credito && !pix) || pagamentos.length !== 1 || pagamentos[0].amount !== ordem.total_amount ||
      (!confirmado && !integracao)) return;
  return vincularOrdemMP(integracao,sandbox ? "teste" : "quiosque",credito ? "credito" : "pix",
    pedidoId,ordem.id,totalCentavos,confirmado);
}

async function verificarPendente(cliente, integracao, id, sandbox, recebedor) {
  const ordem = ordemMercadoPago(id);
  const esperado = ordem ? id.toUpperCase() : id;
  if (!ordem && !/^\d{1,32}$/.test(id)) return;
  if (ordem && /^ORDTST/i.test(id) !== sandbox) return;
  let recurso;
  try {
    recurso = ordem ? await cliente.consultarOrdem(esperado) : await cliente.consultarPagamento(id);
  } catch (erro) {
    // A simulação de entrega do painel pode apontar para um recurso inexistente.
    if ([400, 401, 403, 404].includes(erro.status)) return;
    throw erro;
  }
  const conta = ordem ? recurso.collector_id ?? recurso.user_id : recurso.collector_id;
  if (String(recurso.id) !== esperado || String(conta) !== recebedor ||
      (!ordem && recurso.live_mode !== !sandbox) || (recurso.currency_id && recurso.currency_id !== "BRL")) return;
  await banco("servico_mp_registrar_webhook_pendente", {
    p_integracao: integracao, p_tipo: ordem ? "ordem" : "pagamento", p_recurso: esperado
  });
}

export async function receberNotificacao(req, res, { segredo, token, sandbox, integracao, recebedor, pendente }) {
  if (req.method !== "POST") return res.status(405).end();
  if (!segredo || !token) return res.status(503).end();
  const id = req.query?.["data.id"];
  if (!assinaturaValida(id,req.headers["x-request-id"],req.headers["x-signature"],segredo)) {
    console.warn("Mercado Pago: assinatura da notificação inválida");
    return res.status(401).end();
  }

  const cliente = mercadoPago(token);
  const ambiente = sandbox ? "sandbox" : "producao";
  if (pendente) {
    await verificarPendente(cliente, integracao, id, sandbox, recebedor);
    return res.status(200).end();
  }
  if (!ordemMercadoPago(id)) {
    await registrarNotificacaoMercadoPago({cliente,payload:req.body,id,ambiente,integracao,recebedor});
    return res.status(200).end();
  }
  if (/^ORDTST/i.test(id) !== sandbox) return res.status(200).end();

  const idOrdem = id.toUpperCase();
  try {
    const ordem = await cliente.consultarOrdem(idOrdem);
    if (recebedor && ordem.collector_id != null && String(ordem.collector_id) !== recebedor) return res.status(200).end();
    if (referenciaPixFrente(ordem.external_reference)) {
      if (ordem.id !== idOrdem) throw new Error("ID da ordem Pix divergente.");
      await conciliarOrdemPixFrente(ordem,ambiente,undefined,integracao);
    } else if (ordem.id === idOrdem) {
      const vinculada = await confirmarOrdem(ordem,sandbox,integracao);
      if (integracao && vinculada !== true) return res.status(200).end();
      await registrarNotificacaoMercadoPago({cliente,id:idOrdem,ambiente,ordem,integracao});
    }
    return res.status(200).end();
  } catch {
    console.error("Mercado Pago: falha no processamento da ordem", {ambiente});
    return res.status(502).end();
  }
}
