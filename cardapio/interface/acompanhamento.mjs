import { consultarPedido } from "../dados/pedidos.mjs";
import { lerPedidoMesa, guardarPedidoMesa, apagarPedidoMesa } from "../dados/pedido-mesa-local.mjs";
import { prepararPedidoPronto } from "./pedido-pronto.mjs";
import { exibirAvisosPedido } from "./avisos-pedido.mjs";
import { resumirPedido } from "../regras/acompanhamento.mjs";
const el = id => document.getElementById(id);

export function configurarAcompanhamento(ctx) {
  const retirada = prepararPedidoPronto(ctx);
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

  async function acompanhar(pedidoConfirmado) {
    const pedido = pedidoConfirmado ?? await consultarPedido({ p_slug: ctx.p_slug, p_id: ctx.p_id });
    if (!pedido) throw new Error("Pedido indisponível.");
    el("numero-pedido").hidden = !pedido.comanda;
    if (pedido.comanda) el("numero-pedido").textContent = `${pedido.mesa ? "Comanda" : "Pedido nº"} ${pedido.comanda}`;
    const resumo = resumirPedido(pedido, ctx);
    ctx.aguardandoPix = resumo.aguardandoPix;
    ctx.acompanhamentoAtivo = resumo.acompanhamentoAtivo;
    el("titulo-andamento").hidden = false;
    const mensagem = el("mensagem");
    if (mensagem.firstChild?.nodeValue !== resumo.mensagem) mensagem.textContent = resumo.mensagem;
    retirada.atualizar(pedido);
    if (ctx.p_mesa && (pedido.cancelado || !ctx.acompanhamentoAtivo)) apagarPedidoMesa(ctx.p_slug,ctx.p_mesa);
    exibirAvisosPedido(el("mensagem"),pedido.avisos ?? []);
    if (!ctx.aguardandoPix) el("pagamento-pix").hidden = true;
    const volta = el("voltar-cardapio");
    const destino = new URLSearchParams({ loja: ctx.p_slug });
    if (pedido.mesa) destino.set("mesa", pedido.mesa);
    volta.href = "?" + destino;
    volta.hidden = ctx.aguardandoPix || Boolean(pedido.mesa && ctx.acompanhamentoAtivo);
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

  async function retomarPedidoMesa() {
    if (ctx.p_id || !ctx.p_mesa) return null;
    const id = lerPedidoMesa(ctx.p_slug,ctx.p_mesa);
    if (!id) return null;
    const pedido = await consultarPedido({p_slug:ctx.p_slug,p_id:id});
    if (!pedido?.mesa || pedido.cancelado || !resumirPedido(pedido,ctx).acompanhamentoAtivo) {
      apagarPedidoMesa(ctx.p_slug,ctx.p_mesa);
      return null;
    }
    ctx.p_id = id;
    ctx.parametros.set("pedido",id);
    ctx.parametros.delete("mesa");
    history.replaceState(null,"","?" + ctx.parametros);
    return pedido;
  }

  function confirmarPedidoMesa() {
    if (!ctx.p_mesa) return;
    guardarPedidoMesa(ctx.p_slug,ctx.p_mesa,ctx.p_id);
    retirada.confirmar();
  }

  Object.assign(ctx, { executarComFeedback, acompanhar, retomarPedidoMesa,
    prepararSomMesa:retirada.prepararSom, confirmarPedidoMesa });
}
