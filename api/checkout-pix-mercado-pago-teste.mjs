import { ordemNoAmbienteMP } from "../lib/mercado-pago-ambiente.mjs";
import { cotarFreteCheckout } from "../lib/cotar-frete-checkout.mjs";
import { reservarPedidoMP, vincularOrdemMP } from "../lib/reserva-pedido-mp.mjs";
import { codigoSuspensao, responderLojaFechada } from "../lib/suspensao-checkout.mjs";
import { emailPixMercadoPago, mercadoPago } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";
import { cotarFreteRemo, enderecoValido, enderecoLegadoValido } from "../lib/frete-remo.mjs";

export async function checkout(req, res, { sandbox, token }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const { p_slug, p_id, p_cliente = null, p_mesa = null, p_itens, endereco, pagamento, frete_centavos: freteInformado } = req.body ?? {};
  if (typeof p_slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p_slug) || p_slug.length > 100 ||
      typeof p_id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p_id) ||
      !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido inválido." });
  }
  if (pagamento !== undefined && (!endereco || p_mesa || !["online", "na_entrega"].includes(pagamento))) {
    return res.status(400).json({ erro: "Confira os dados da entrega." });
  }
  const enderecoAceito = enderecoValido(endereco) || (sandbox && enderecoLegadoValido(endereco));
  if (pagamento !== undefined && (!enderecoAceito || !Number.isSafeInteger(freteInformado) || freteInformado < 0)) {
    return res.status(400).json({ erro: "Confira o endereço e a cotação da entrega." });
  }
  if (pagamento !== undefined && !sandbox && (!/^\d{10,11}$/.test(endereco.telefone || "") ||
      (pagamento === "online" && endereco.metodo_pagamento !== "pix") ||
      (pagamento === "na_entrega" && !["dinheiro", "maquininha"].includes(endereco.metodo_pagamento)))) {
    return res.status(400).json({ erro: "Confira o contato e a forma de pagamento." });
  }
  const naEntrega = pagamento === "na_entrega";

  try {
    let freteCentavos = 0;
    if (pagamento !== undefined) {
      freteCentavos = await cotarFreteRemo(p_slug, endereco);
      if (freteCentavos !== freteInformado) {
        return res.status(409).json({ erro: "O valor da entrega mudou. Confira a nova cotação antes de confirmar.", frete_centavos: freteCentavos });
      }
    }
    if (naEntrega) {
      const id = await banco("enviar_pedido_pagamento_na_entrega_com_frete", {
        p_slug, p_id, p_cliente, p_itens, p_endereco: endereco, p_frete_centavos: freteCentavos
      });
      return res.status(200).json({ pedido: id });
    }
    const ambiente = sandbox ? "teste" : "quiosque";
    const reserva = await reservarPedidoMP({ p_slug, p_id, p_cliente, p_mesa, p_itens,
      ...(pagamento === "online" && { p_endereco: endereco, p_frete: freteCentavos }) },
      { sandbox, meio: "pix", token });
    if (!reserva) return res.status(503).json({ erro: "Pix indisponível." });
    const { pedido, integracao } = reserva;
    const cliente = mercadoPago(reserva.token);

    const ordem = pedido.cobranca ? await cliente.consultarOrdem(pedido.cobranca)
      : await cliente.criarPix({
        pedidoId: p_id, totalCentavos: pedido.total_centavos,
        email: emailPixMercadoPago(sandbox, p_id),
        pagadorTeste: sandbox ? { first_name: "APRO" } : undefined
      });
    if (!ordemNoAmbienteMP(ordem, sandbox, reserva.recebedor) ||
        ordem.external_reference !== p_id || ordem.total_amount !== (pedido.total_centavos / 100).toFixed(2)) {
      throw new Error("Ordem divergente.");
    }
    if (!pedido.cobranca) {
      const vinculada = await vincularOrdemMP(integracao, ambiente, "pix", p_id, ordem.id, pedido.total_centavos);
      if (!vinculada) throw new Error("Vínculo da ordem recusado.");
    }
    if (ordem.status === "processed") return res.status(200).json({ aguardaConfirmacao: true });
    const metodo = ordem.transactions?.payments?.[0]?.payment_method;
    if (sandbox && (ordem.status !== "action_required" || !metodo?.qr_code)) return res.status(200).json({ aguardaConfirmacao: true });
    if (ordem.status !== "action_required" || metodo?.id !== "pix" ||
        (!sandbox && !metodo.qr_code_base64) || !metodo.qr_code) {
      return res.status(409).json({ erro: "QR Code indisponível para esta cobrança." });
    }
    return res.status(200).json({ imagem: metodo.qr_code_base64 || null, copiaECola: metodo.qr_code, ...(sandbox && { sandbox: true }) });
  } catch (erro) {
    if (erro.codigo === codigoSuspensao) return responderLojaFechada(res);
    console.error("Checkout Mercado Pago", erro.message, erro.codigo || "", erro.diagnostico || "");
    return res.status(502).json({ erro: "Não foi possível preparar o Pix." });
  }
}

export default function handler(req, res) {
  if (new URL(req.url || "/", "http://localhost").searchParams.get("cotacao_frete") === "1") {
    return cotarFreteCheckout(req, res);
  }
  return checkout(req, res, { sandbox: true, token: process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN });
}
