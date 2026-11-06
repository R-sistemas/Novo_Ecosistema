import { mercadoPago } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";

export async function checkout(req, res, { sandbox, token }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (!token) return res.status(503).json({ erro: "Pix indisponível." });
  const { p_slug, p_id, p_cliente = null, p_mesa = null, p_itens, email } = req.body ?? {};
  if (p_slug !== (sandbox ? "loja-teste" : "quiosque-dorafa") || typeof p_id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p_id) ||
      !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido de teste inválido." });
  }
  if (!sandbox && p_itens.length && (typeof email !== "string" ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ erro: "Informe um e-mail válido para gerar o Pix." });
  }
  try {
    const ambiente = sandbox ? "teste" : "quiosque";
    const pedido = await banco("reservar_pix_mercado_pago_" + ambiente, { p_id, p_cliente, p_mesa, p_itens });
    const cliente = mercadoPago(token);
    if (sandbox && pedido.cobranca) return res.status(200).json({ aguardaConfirmacao: true });
    const ordem = pedido.cobranca ? await cliente.consultarOrdem(pedido.cobranca)
      : await cliente.criarPix({
        pedidoId: p_id, totalCentavos: pedido.total_centavos,
        email: sandbox ? "test_payer@example.com" : email,
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
