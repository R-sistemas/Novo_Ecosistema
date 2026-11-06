import { mercadoPago } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";

export async function checkoutCredito(req, res, { sandbox, accessToken }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (!accessToken) return res.status(503).json({ erro: "Crédito online indisponível." });
  const ambiente = sandbox ? "teste" : "quiosque";
  const { p_slug, p_id, p_cliente, p_mesa = null, p_itens, cartao } = req.body ?? {};
  if (p_slug !== (sandbox ? "loja-teste" : "quiosque-dorafa") || typeof p_id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p_id) ||
      !Array.isArray(p_itens) || !p_itens.length || p_itens.length > 30 ||
      typeof cartao?.token !== "string" || !/^[a-z0-9_-]{10,256}$/i.test(cartao.token) ||
      typeof cartao.bandeira !== "string" || !/^[a-z0-9_]{1,32}$/i.test(cartao.bandeira) ||
      typeof cartao.email !== "string" || cartao.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cartao.email)) {
    return res.status(400).json({ erro: "Dados do pagamento inválidos." });
  }
  try {
    const pedido = await banco("reservar_credito_mercado_pago_" + ambiente, { p_id, p_cliente, p_mesa, p_itens });
    const cliente = mercadoPago(accessToken);
    const ordem = pedido.cobranca ? await cliente.consultarOrdem(pedido.cobranca)
      : await cliente.criarCartao({
        pedidoId: p_id, totalCentavos: pedido.total_centavos,
        pagador: { email: cartao.email },
        metodo: { id: cartao.bandeira, type: "credit_card", token: cartao.token, installments: 1 }
      });
    if (!/^ORD[A-Z0-9]+$/.test(ordem.id) || /^ORDTST/.test(ordem.id) !== sandbox || ordem.external_reference !== p_id ||
        ordem.total_amount !== (pedido.total_centavos / 100).toFixed(2) ||
        ordem.transactions?.payments?.[0]?.payment_method?.type !== "credit_card") {
      throw new Error("Ordem de teste divergente.");
    }
    if (!pedido.cobranca && !await banco("atualizar_credito_mercado_pago_" + ambiente, {
      p_pedido: p_id, p_cobranca: ordem.id, p_valor: pedido.total_centavos, p_confirmado: false
    })) throw new Error("Vínculo da ordem recusado.");
    return res.status(200).json({ estado: ordem.status });
  } catch (erro) {
    if (erro.message.startsWith("Mercado Pago retornou HTTP 402")) {
      try {
        if (await banco("recusar_credito_mercado_pago_" + ambiente, { p_pedido: p_id })) {
          return res.status(402).json({ erro: sandbox ? "Cartão recusado no teste. Você pode tentar novamente."
            : "Cartão recusado. Você pode tentar novamente." });
        }
      } catch (falha) {
        console.error("Registro da recusa de crédito de teste", falha.message);
      }
    }
    console.error("Crédito Mercado Pago teste", erro.message);
    return res.status(502).json({ erro: "Não foi possível verificar a cobrança. Tente novamente neste pedido." });
  }
}

export default function handler(req, res) {
  return checkoutCredito(req, res, { sandbox: true, accessToken: process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN });
}
