import { emailPixMercadoPago, mercadoPago, pixMercadoPagoRecebido } from "./mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "./banco-mercado-pago-teste.mjs";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const prefixo = "pdv-";
const estadosFinais = new Set(["confirmado", "cancelado", "expirado", "rejeitado"]);
export const referenciaPixFrente = referencia => typeof referencia === "string" &&
  referencia.startsWith(prefixo) && uuid.test(referencia.slice(prefixo.length));

export async function conciliarOrdemPixFrente(ordem, ambiente, reserva) {
  const pedidoId = ordem?.external_reference;
  const totalCentavos = Math.round(Number(ordem?.total_amount) * 100);
  const pagamentos = ordem?.transactions?.payments;
  const metodo = pagamentos?.[0]?.payment_method;
  if (!referenciaPixFrente(pedidoId) || !/^ORD[A-Z0-9]+$/.test(ordem.id) ||
      /^ORDTST/.test(ordem.id) !== (ambiente === "sandbox") ||
      !Number.isSafeInteger(totalCentavos) || totalCentavos < 1 || pagamentos?.length !== 1 ||
      pagamentos[0].amount !== (totalCentavos / 100).toFixed(2) || metodo?.id !== "pix" || metodo?.type !== "bank_transfer" ||
      (reserva && (pedidoId !== prefixo + reserva.id || totalCentavos !== reserva.valor_centavos ||
        (reserva.ordem_id && ordem.id !== reserva.ordem_id)))) throw new Error("Ordem Pix do caixa divergente.");

  let estado = "aguardando";
  if (pixMercadoPagoRecebido(ordem, { pedidoId, totalCentavos })) estado = "confirmado";
  else if (["canceled", "failed"].includes(ordem.status)) {
    estado = ordem.status_detail === "expired" ? "expirado" : ordem.status === "canceled" ? "cancelado" : "rejeitado";
  }
  const registrado = await banco("conciliar_pix_frente", {
    p_id: pedidoId.slice(prefixo.length), p_ordem: ordem.id, p_valor: totalCentavos, p_ambiente: ambiente, p_estado: estado
  });
  return {
    estado: registrado,
    ...(registrado === "aguardando" && ordem.status === "action_required" ? {
      imagem: metodo.qr_code_base64, copiaECola: metodo.qr_code
    } : {})
  };
}

function dadosPublicos(reserva) {
  return { id: reserva.id, pedido: reserva.pedido_id, valor: reserva.valor_centavos,
    estado: reserva.estado, teste: reserva.ambiente === "sandbox", itens: reserva.itens, desconto: reserva.desconto_centavos };
}

export async function pixFrenteCaixa(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const sessao = req.headers.authorization;
  if (typeof sessao !== "string" || !/^Bearer \S+$/.test(sessao)) {
    return res.status(401).json({ erro: "Entre no caixa para consultar o Pix." });
  }
  const { acao, p_caixa, p_id = null, p_pedido = null, p_itens = [], p_desconto = 0, p_total } = req.body;
  if (!uuid.test(p_caixa ?? "") || (p_id !== null && !uuid.test(p_id)) ||
      !["criar", "consultar", "cancelar"].includes(acao) ||
      (acao === "criar" && (!uuid.test(p_id ?? "") || (p_pedido !== null && !uuid.test(p_pedido)) ||
        !Array.isArray(p_itens) || p_itens.length > 100 || !Number.isSafeInteger(p_desconto) ||
        !Number.isSafeInteger(p_total)))) {
    return res.status(400).json({ erro: "Confira os dados da cobrança." });
  }

  try {
    const reserva = acao === "criar"
      ? await banco("reservar_pix_frente", { p_caixa, p_id, p_pedido, p_itens, p_desconto, p_total,
        p_email: emailPixMercadoPago(false) }, sessao)
      : await banco("consultar_pix_frente", { p_caixa, p_id }, sessao);
    if (!reserva) return res.status(200).json(null);
    const resposta = dadosPublicos(reserva);
    if (estadosFinais.has(reserva.estado)) return res.status(200).json(resposta);

    const teste = reserva.ambiente === "sandbox";
    const segredo = teste ? process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET : process.env.MERCADO_PAGO_QUIOSQUE_WEBHOOK_SECRET;
    const token = teste ? process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN : process.env.MERCADO_PAGO_QUIOSQUE_ACCESS_TOKEN;
    if (!segredo || !token) return res.status(503).json({ erro: "Pix indisponível. Verifique a integração da loja." });
    const mp = mercadoPago(token);
    let ordem;
    if (reserva.ordem_id) ordem = await mp.consultarOrdem(reserva.ordem_id);
    else {
      try {
        ordem = await mp.criarPix({ pedidoId: prefixo + reserva.id, totalCentavos: reserva.valor_centavos,
          email: teste ? emailPixMercadoPago(true) : reserva.email,
          pagadorTeste: teste ? { first_name: "APRO" } : undefined, expiraEm: "PT30M" });
      } catch (erro) {
        if ([400, 422].includes(erro.status) && !erro.codigos?.some(codigo => codigo.includes("idempotency"))) {
          resposta.estado = await banco("conciliar_pix_frente", {
            p_id: reserva.id, p_ordem: null, p_valor: reserva.valor_centavos, p_ambiente: reserva.ambiente, p_estado: "rejeitado"
          });
          console.warn("Pix do caixa recusado na criação", erro.message);
          return res.status(200).json(resposta);
        }
        throw erro;
      }
    }
    let conciliado = await conciliarOrdemPixFrente(ordem, reserva.ambiente, reserva);
    if (acao === "cancelar" && conciliado.estado === "aguardando" && ["created", "action_required"].includes(ordem.status)) {
      try { ordem = await mp.cancelarOrdem(ordem.id, "cancelar-" + reserva.id); }
      catch { ordem = await mp.consultarOrdem(ordem.id); }
      conciliado = await conciliarOrdemPixFrente(ordem, reserva.ambiente, reserva);
    }
    return res.status(200).json({ ...resposta, ...conciliado });
  } catch (erro) {
    if (erro.mensagem) return res.status(400).json({ erro: erro.mensagem });
    console.error("Pix do caixa", erro.message);
    return res.status(502).json({ erro: "Não foi possível consultar o Pix agora. Tente novamente nesta cobrança." });
  }
}
