import { criarContexto } from "../regras/contexto.mjs";
import { consultarCardapio } from "../dados/pedidos.mjs";
import { aplicarTema } from "../../tema-cardapio.mjs";
import { montarVitrine } from "../../vitrine-cardapio.mjs";
import { iniciarCheckoutEntrega } from "../../checkout-entrega.mjs";
import { configurarAcompanhamento } from "./acompanhamento.mjs";
import { configurarPix } from "./pix.mjs";
import { configurarFrete } from "./frete.mjs";
import { configurarPagamento } from "./pagamento.mjs";
import { configurarEnvio } from "./envio.mjs";
const el = id => document.getElementById(id);

export function iniciarCardapio() {
  const ctx = criarContexto(location.search);
  configurarAcompanhamento(ctx);
  configurarPix(ctx);
  el("acompanhar").onclick = () => ctx.executarComFeedback(ctx.acompanhar);
  ctx.executarComFeedback(async () => {
    if (!ctx.p_slug) throw new Error("Abra o link do cardápio do estabelecimento.");
    const menu = await consultarCardapio({ p_slug: ctx.p_slug });
    if (!menu) throw new Error("Cardápio indisponível.");
    el("loja").textContent = menu.nome;
    aplicarTema(document.documentElement, menu.cor, menu.fundo);
    const marca = el("marca-loja");
    marca.textContent = menu.nome.split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
    if (menu.logo) {
      const logo = document.createElement("img");
      logo.src = menu.logo;
      logo.alt = "";
      marca.replaceChildren(logo);
    }
    if (menu.agradecimento) el("arte-agradecimento").src = menu.agradecimento;
    if (ctx.p_mesa || ctx.entrega) {
      el("contexto-cardapio").textContent = ctx.p_mesa ? "Pedido na mesa" : "Entrega";
      el("contexto-cardapio").hidden = false;
    }
    const pedidoRetomado = await ctx.retomarPedidoMesa();
    if (ctx.p_id) {
      el("acompanhar").hidden = false;
      if (await ctx.acompanhar(pedidoRetomado) && !ctx.creditoTeste && !ctx.creditoQuiosque) await ctx.mostrarPix({ p_slug: ctx.p_slug, p_id: ctx.p_id, p_itens: [] });
      return;
    }
    if (!menu.produtos.length) throw new Error("Nenhum produto disponível.");
    ctx.carrinho = montarVitrine(menu.produtos);
    if (ctx.p_slug === "quiosque-dorafa" && !ctx.p_mesa) {
      el("carrinho-cardapio").classList.add("checkout-entrega");
      el("contexto-cardapio").textContent = "Entrega";
      el("contexto-cardapio").hidden = false;
      await iniciarCheckoutEntrega({
        slug: ctx.p_slug, menu, carrinho: ctx.carrinho,
        aoPix: dados => ctx.mostrarPix(dados),
        async aoConfirmar(id, metodo) {
          ctx.p_id = id;
          ctx.parametros.set("pedido", id);
          ctx.parametros.set("entrega", "sim");
          if (metodo === "credito") {
            ctx.creditoQuiosque = true;
            ctx.parametros.set("cartao", "credito");
            ctx.parametros.delete("pix");
          } else if (metodo === "pix") {
            ctx.parametros.set("pix", "mercado-pago");
            ctx.parametros.delete("cartao");
          }
          history.replaceState(null, "", "?" + ctx.parametros);
          el("pedido").hidden = true;
          el("carrinho-cardapio").close();
          el("vitrine").hidden = true;
          el("barra-cardapio").hidden = true;
          el("acompanhar").hidden = false;
          window.scrollTo(0, 0);
          await ctx.acompanhar();
        }
      });
      return;
    }
    configurarFrete(ctx);
    await configurarPagamento(ctx);
    configurarEnvio(ctx);
  });
  setInterval(() => {
    if (ctx.p_id && ctx.acompanhamentoAtivo && !document.hidden) void ctx.executarComFeedback(ctx.acompanhar);
  }, 5000);
}
