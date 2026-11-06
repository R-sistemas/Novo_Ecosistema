import { mercadoPago } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const token = process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN;
  if (!token) return res.status(503).json({ erro: "Pix de teste indisponível." });
  const { p_slug, p_id, p_cliente = null, p_mesa = null, p_itens } = req.body ?? {};
  if (p_slug !== "loja-teste" || typeof p_id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p_id) ||
      !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido de teste inválido." });
  }
  try {
    const pedido = await banco("reservar_pix_mercado_pago_teste", { p_id, p_cliente, p_mesa, p_itens });
    if (!pedido.cobranca) {
      const ordem = await mercadoPago(token).criarPix({
        pedidoId: p_id, totalCentavos: pedido.total_centavos,
        email: "test_payer@example.com", pagadorTeste: { first_name: "APRO" }
      });
      if (!/^ORDTST[A-Z0-9]+$/.test(ordem.id) || ordem.external_reference !== p_id ||
          ordem.total_amount !== (pedido.total_centavos / 100).toFixed(2)) {
        throw new Error("Ordem de teste divergente.");
      }
      const vinculada = await banco("atualizar_pix_mercado_pago_teste", {
        p_pedido: p_id, p_cobranca: ordem.id, p_valor: pedido.total_centavos, p_confirmado: false
      });
      if (!vinculada) throw new Error("Vínculo da ordem recusado.");
    }
    return res.status(200).json({ aguardaConfirmacao: true });
  } catch (erro) {
    console.error("Checkout Mercado Pago teste", erro.message);
    return res.status(502).json({ erro: "Não foi possível preparar o Pix de teste." });
  }
}
