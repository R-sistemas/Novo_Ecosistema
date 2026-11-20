import { consultarPedido } from "../dados/pedidos.mjs";
import { exibirAvisosPedido } from "./avisos-pedido.mjs";
import { resumirPedido } from "../regras/acompanhamento.mjs";
const el = id => document.getElementById(id);

export function configurarAcompanhamento(ctx) {
  async function executarComFeedback(acao) {
    if (ctx.ocupado) return;
    ctx.ocupado = true;
    try {
      await acao();
    } catch (erro) {
      el(el("carrinho-cardapio").open ? "erro-pedido" : "mensagem").textContent = erro.message;
    } finally {
      ctx.ocupado = false;
    }
  }

  async function acompanhar() {
    const pedido = await consultarPedido({ p_slug: ctx.p_slug, p_id: ctx.p_id });
    if (!pedido) throw new Error("Pedido indisponível.");
    el("numero-pedido").hidden = !pedido.comanda;
    if (pedido.comanda) el("numero-pedido").textContent = `${pedido.mesa ? "Comanda" : "Pedido nº"} ${pedido.comanda}`;
    const resumo = resumirPedido(pedido, ctx);
    ctx.aguardandoPix = resumo.aguardandoPix;
    ctx.acompanhamentoAtivo = resumo.acompanhamentoAtivo;
    el("mensagem").textContent = resumo.mensagem;
    exibirAvisosPedido(el("mensagem"),pedido.avisos ?? []);
    if (!ctx.aguardandoPix) el("pagamento-pix").hidden = true;
    const { pixConfirmado } = resumo;
    const painelConfirmacao = el("pix-confirmado");
    painelConfirmacao.hidden = !pixConfirmado;
    if (pixConfirmado && !painelConfirmacao.dataset.exibido) {
      painelConfirmacao.dataset.exibido = "true";
      painelConfirmacao.classList.remove("pix-confirmado-entrar");
      void painelConfirmacao.offsetWidth;
      painelConfirmacao.classList.add("pix-confirmado-entrar");
    }
    const arte = el("arte-agradecimento");
    arte.hidden = !arte.getAttribute("src") || ctx.aguardandoPix || pedido.estado === "recusado";
    return ctx.aguardandoPix;
  }

  Object.assign(ctx, { executarComFeedback, acompanhar });
}
