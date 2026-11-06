import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { mercadoPago, pixMercadoPagoRecebido } from "./lib/mercado-pago.mjs";

try {
  const cliente = mercadoPago(process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN);
  const pedido = { pedidoId: randomUUID(), totalCentavos: 5000 };
  let ordem = await cliente.criarPix({
    ...pedido,
    email: "test_payer@example.com",
    pagadorTeste: { first_name: "APRO" }
  });
  if (!/^ORD[A-Z0-9]+$/.test(ordem.id)) throw new Error("Identificador de teste inválido.");
  console.log("Ordem de teste:", ordem.id, ordem.status);
  for (let tentativa = 0; tentativa < 12 && ordem.status === "action_required"; tentativa++) {
    await esperar(5000);
    ordem = await cliente.consultarOrdem(ordem.id);
  }
  console.log("Resultado:", ordem.status, ordem.status_detail,
    ordem.transactions?.payments?.[0]?.status);
  if (!pixMercadoPagoRecebido(ordem, pedido)) {
    throw new Error("Pix de teste ainda não confirmado para a referência e o valor esperados.");
  }
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
