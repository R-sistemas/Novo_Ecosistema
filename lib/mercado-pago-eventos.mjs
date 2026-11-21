import { createHash } from "node:crypto";
import { uuid } from "./painel-sessao.mjs";
import { bancoMercadoPagoTeste as banco } from "./banco-mercado-pago-teste.mjs";

const estados = new Map([
  ["approved","confirmado"], ["accredited","confirmado"],
  ["created","pendente"], ["pending","pendente"], ["action_required","pendente"],
  ["processing","pendente"], ["in_process","pendente"], ["authorized","pendente"],
  ["rejected","recusado"], ["failed","recusado"], ["expired","cancelado"],
  ["canceled","cancelado"], ["cancelled","cancelado"], ["refunded","estornado"],
  ["partially_refunded","estorno_parcial"], ["charged_back","contestacao"],
  ["in_mediation","contestacao"]
]);

export const ordemMercadoPago = id => /^ORD[A-Z0-9]+$/i.test(id);
const ambienteDaOrdem = id => /^ORDTST/i.test(id) ? "sandbox" : "producao";

function idNumerico(id) {
  if (typeof id !== "string" && !Number.isSafeInteger(id)) return null;
  const texto = String(id);
  return /^\d{1,32}$/.test(texto) ? texto : null;
}

function centavos(valor) {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  if (typeof valor === "number" && !Number.isSafeInteger(Math.round(valor * 100))) return null;
  const partes = String(valor).match(/^(\d{1,17})(?:\.(\d{1,2}))?$/);
  if (!partes) return null;
  const total = BigInt(partes[1]) * 100n + BigInt((partes[2] ?? "").padEnd(2,"0"));
  return total <= 9223372036854775807n ? String(total) : null;
}

function dataPSP(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(valor)) return null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function observacao(tipo, recurso, pedido, cobranca, ambiente, estado, valor, ocorridoEm) {
  if (typeof pedido !== "string" || !uuid.test(pedido)) return null;
  // O manifest autentica a entrega, sem cobrir o corpo. A chave é derivada do recurso autenticado.
  const chave = JSON.stringify([tipo,recurso,pedido,cobranca,estado,valor,ocorridoEm]);
  return {
    p_pedido:pedido, p_provedor:"mercado_pago", p_ambiente:ambiente, p_cobranca:cobranca,
    p_evento:tipo + ":" + createHash("sha256").update(chave).digest("hex"),
    p_estado:estado, p_valor:valor, p_ocorrido_em:ocorridoEm
  };
}

function eventoOrdem(ordem, id, ambiente) {
  if (ordem?.id !== id || ambienteDaOrdem(id) !== ambiente || (ordem.currency_id && ordem.currency_id !== "BRL")) return null;
  const detalhe = estados.get(ordem.status_detail);
  const estado = ["estorno_parcial","estornado","contestacao"].includes(detalhe) ? detalhe
    : ordem.status === "processed"
      ? ordem.status_detail === "accredited" ? "confirmado" : "desconhecido"
      : estados.get(ordem.status) ?? "desconhecido";
  return observacao("order",id,ordem.external_reference,id,ambiente,estado,centavos(ordem.total_amount),
    dataPSP(ordem.last_updated_date));
}

function eventoPayment(pagamento, id, ambiente, contestacao) {
  if (idNumerico(pagamento?.id) !== id || pagamento.live_mode !== (ambiente === "producao") ||
    pagamento.currency_id !== "BRL") return null;
  const bruto = centavos(pagamento.transaction_amount);
  const devolvido = centavos(pagamento.transaction_amount_refunded);
  const estado = contestacao ? "contestacao"
    : pagamento.status === "approved" && bruto !== null && devolvido !== null && BigInt(devolvido) > 0n
      ? BigInt(devolvido) < BigInt(bruto) ? "estorno_parcial" : "estornado"
      : estados.get(pagamento.status) ?? "desconhecido";
  return observacao(contestacao ? "chargeback" : "payment",contestacao?.id ?? id,
    pagamento.external_reference,id,ambiente,estado,bruto,dataPSP(
      contestacao ? contestacao.date_last_updated : pagamento.date_last_updated
    ));
}

async function eventoNotificacao({ cliente, payload, id, ambiente, ordem }) {
  if (ordem) return eventoOrdem(ordem,id,ambiente);
  if (!idNumerico(id)) return null;
  const prazo = AbortSignal.timeout(12000);
  if (payload?.type === "payment" && /^payment\.(created|updated)$/.test(payload.action ?? "")) {
    return eventoPayment(await cliente.consultarPagamento(id,prazo),id,ambiente);
  }
  if (!["chargebacks","topic_chargebacks_wh"].includes(payload?.type)) return null;
  const vendedor = idNumerico((await cliente.consultarConta(prazo)).id);
  if (!vendedor) return null;
  const disputa = await cliente.consultarContestacao(id,vendedor,prazo);
  if (idNumerico(disputa?.id) !== id || !Array.isArray(disputa.payments) || disputa.payments.length !== 1 ||
    (disputa.currency && disputa.currency !== "BRL")) return null;
  const pagamentoId = idNumerico(disputa.payments[0]?.id ?? disputa.payments[0]);
  if (!pagamentoId) return null;
  return eventoPayment(await cliente.consultarPagamento(pagamentoId,prazo),pagamentoId,ambiente,disputa);
}

export async function registrarNotificacaoMercadoPago(opcoes) {
  try {
    const evento = await eventoNotificacao(opcoes);
    if (evento) await banco("registrar_evento_financeiro_psp",evento);
  } catch {
    console.warn("Mercado Pago: observação financeira indisponível", {ambiente:opcoes.ambiente});
  }
}
