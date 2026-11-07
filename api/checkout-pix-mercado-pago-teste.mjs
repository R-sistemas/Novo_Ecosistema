import { emailPixMercadoPago, mercadoPago } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";

export async function checkout(req, res, { sandbox, token }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const { p_slug, p_id, p_cliente = null, p_mesa = null, p_itens, endereco, pagamento } = req.body ?? {};
  if (p_slug !== (sandbox ? "loja-teste" : "quiosque-dorafa") || typeof p_id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p_id) ||
      !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido inválido." });
  }
  if (pagamento !== undefined && (!endereco || p_mesa || !["online", "na_entrega"].includes(pagamento))) {
    return res.status(400).json({ erro: "Confira os dados da entrega." });
  }
  const naEntrega = pagamento === "na_entrega";
  if (!naEntrega && !token) return res.status(503).json({ erro: "Pix indisponível." });
  try {
    if (naEntrega) {
      const id = await banco("enviar_pedido_pagamento_na_entrega", {
        p_slug, p_id, p_cliente, p_itens, p_endereco: endereco
      });
      return res.status(200).json({ pedido: id });
    }
    const ambiente = sandbox ? "teste" : "quiosque";
    const pedido = pagamento === "online"
      ? await banco("reservar_pix_entrega_" + ambiente, { p_id, p_cliente, p_itens, p_endereco: endereco })
      : await banco("reservar_pix_mercado_pago_" + ambiente, { p_id, p_cliente, p_mesa, p_itens });
    const cliente = mercadoPago(token);
    if (sandbox && pedido.cobranca) return res.status(200).json({ aguardaConfirmacao: true });
    const ordem = pedido.cobranca ? await cliente.consultarOrdem(pedido.cobranca)
      : await cliente.criarPix({
        pedidoId: p_id, totalCentavos: pedido.total_centavos,
        email: emailPixMercadoPago(sandbox),
        pagadorTeste: sandbox ? { first_name: "APRO" } : undefined
      });
    if (!/^ORD[A-Z0-9]+$/.test(ordem.id) || /^ORDTST/.test(ordem.id) !== sandbox ||
        ordem.external_reference !== p_id || ordem.total_amount !== (pedido.total_centavos / 100).toFixed(2)) {
      throw new Error("Ordem divergente.");
    }
    if (!pedido.cobranca) {
      const vinculada = await banco("atualizar_pix_mercado_pago_" + ambiente, {
        p_pedido: p_id, p_cobranca: ordem.id, p_valor: pedido.total_centavos, p_confirmado: false
      });
      if (!vinculada) throw new Error("Vínculo da ordem recusado.");
    }
    if (sandbox || ordem.status === "processed") return res.status(200).json({ aguardaConfirmacao: true });
    const metodo = ordem.transactions?.payments?.[0]?.payment_method;
    if (ordem.status !== "action_required" || metodo?.id !== "pix" ||
        !metodo.qr_code_base64 || !metodo.qr_code) {
      return res.status(409).json({ erro: "QR Code indisponível para esta cobrança." });
    }
    return res.status(200).json({ imagem: metodo.qr_code_base64, copiaECola: metodo.qr_code });
  } catch (erro) {
    console.error("Checkout Mercado Pago", erro.message);
    return res.status(502).json({ erro: "Não foi possível preparar o Pix." });
  }
}

export default function handler(req, res) {
  return checkout(req, res, { sandbox: true, token: process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN });
}
