import { paraReais } from "../../pdv/regras/moeda.mjs";
import { estadosEntrega } from "../../estado-entrega.mjs";
const estados = { novo: "Recebido", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue", recusado: "Recusado" };

export function resumirPedido(pedido, ctx) {
  const aguardandoPix = (pedido.pix_sandbox || pedido.pix_producao) && !pedido.pix_confirmado;
  const entregaEncerrada = ["entregue", "cancelada"].includes(pedido.estado_remo);
  const acompanhamentoAtivo = aguardandoPix || (!entregaEncerrada && !["entregue", "recusado"].includes(pedido.estado)) ||
    Boolean(pedido.mesa && !pedido.pago && pedido.estado !== "recusado");
  let mensagem = (aguardandoPix ? (ctx.creditoTeste ? "Aguardando confirmação do crédito de teste"
    : ctx.creditoQuiosque ? "Aguardando confirmação do cartão"
      : ctx.pixTeste ? "Aguardando Pix Sandbox" : "Aguardando pagamento Pix") : pedido.cancelado ? "Comanda cancelada" :
    estadosEntrega[pedido.estado_remo] ?? estados[pedido.estado]) +
    (pedido.cancelado ? "" : " · " + ctx.moeda.format(paraReais(pedido.total_centavos)));
  if (pedido.mesa) {
    mensagem += " · Mesa " + pedido.mesa + " · Comanda " + pedido.comanda +
      (pedido.pago ? " · Pago" : aguardandoPix || pedido.estado === "recusado" ? "" : " · Pagar no caixa");
  }
  const pixConfirmado = Boolean((pedido.pix_sandbox || pedido.pix_producao) && pedido.pix_confirmado);
  return { aguardandoPix, acompanhamentoAtivo, mensagem, pixConfirmado };
}
