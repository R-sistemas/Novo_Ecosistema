import { consultarDisponibilidadePix, consultarPagamentoNaEntrega } from "../dados/pedidos.mjs";
const el = id => document.getElementById(id);

export async function configurarPagamento(ctx) {
  if (ctx.p_slug === "quiosque-dorafa") {
    ctx.pixDisponivel = await consultarDisponibilidadePix({ p_slug: ctx.p_slug }).catch(() => false);
  }
  el("tipo-entrega").hidden = !ctx.escolhaPublicaEntrega || ctx.entrega;
  el("pagamento-padrao").hidden = Boolean(ctx.p_mesa) || ctx.entrega || ctx.creditoTeste || ctx.creditoQuiosque;
  el("opcao-pix").hidden = !ctx.pixDisponivel || ctx.creditoTeste || ctx.creditoQuiosque;
  el("opcao-pix").textContent = ctx.pixTeste ? "Pagar com Pix Sandbox"
    : ctx.pixMercadoPagoQuiosque ? "Pagar com Pix Mercado Pago" : "Pagar com Pix";
  const atualizarPagamento = () => {
    const solicitarDocumento = !ctx.pixTeste && !ctx.pixMercadoPagoQuiosque && ctx.formaPagamento === "pix";
    el("dados-pix").hidden = !solicitarDocumento;
    el("documento-pix").required = solicitarDocumento;
  };
  function selecionarPagamento(valor, grupo) {
    ctx.formaPagamento = valor;
    grupo.querySelectorAll("[data-pagamento]").forEach(botao => {
      const selecionado = botao.dataset.pagamento === valor;
      botao.classList.toggle("selecionada", selecionado);
      botao.setAttribute("aria-pressed", String(selecionado));
    });
    atualizarPagamento();
  }
  document.querySelectorAll("#pagamento-padrao [data-pagamento], #pagamento-mesa [data-pagamento]").forEach(botao => {
    botao.addEventListener("click", () => selecionarPagamento(botao.dataset.pagamento, botao.closest(".opcoes-escolha")));
  });
  document.querySelectorAll("#pagamento-entrega [data-pagamento]").forEach(botao => {
    botao.addEventListener("click", () => selecionarPagamento(botao.dataset.pagamento, el("pagamento-entrega")));
  });
  document.querySelectorAll("#tipo-entrega [data-recebimento]").forEach(botao => {
    botao.addEventListener("click", () => {
      const entregar = botao.dataset.recebimento === "entrega";
      document.querySelectorAll("#tipo-entrega [data-recebimento]").forEach(opcao => {
        const selecionada = opcao === botao;
        opcao.classList.toggle("selecionada", selecionada);
        opcao.setAttribute("aria-pressed", String(selecionada));
      });
      ctx.entrega = entregar;
      el("entrega-teste").hidden = !entregar;
      el("entrega-teste").disabled = !entregar;
      el("contexto-cardapio").textContent = entregar ? "Entrega" : "Retirada no local";
      el("contexto-cardapio").hidden = false;
      el("pagamento-padrao").hidden = entregar;
      if (entregar) {
        el("pagamento-entrega").querySelectorAll("[data-pagamento]").forEach(opcao => {
          const selecionada = opcao.dataset.pagamento === "online";
          opcao.classList.toggle("selecionada", selecionada);
          opcao.setAttribute("aria-pressed", String(selecionada));
        });
        ctx.formaPagamento = "online";
        ctx.agendarCotacaoFrete();
      } else {
        clearTimeout(ctx.cotacao.temporizadorCotacao);
        ctx.cotacao.sequenciaCotacao++;
        ctx.cotacao.freteEntregaCentavos = null;
        ctx.cotacao.enderecoCotado = null;
        selecionarPagamento("caixa", el("pagamento-padrao"));
      }
      atualizarPagamento();
    });
  });
  if (ctx.entrega || ctx.escolhaPublicaEntrega) {
    el("entrega-teste").hidden = false;
    el("entrega-teste").disabled = false;
    if (ctx.p_slug === "quiosque-dorafa") {
      el("legenda-entrega").textContent = "Endereço da entrega";
      el("pagamento-entrega").querySelector('[data-pagamento="online"]').textContent = ctx.entregaTeste
        ? "Pix Mercado Pago de teste" : "Pix Mercado Pago";
    }
    if (await consultarPagamentoNaEntrega({ p_slug: ctx.p_slug }).catch(() => false)) {
      el("pagamento-entrega").insertAdjacentHTML("beforeend", '<button class="opcao-escolha" type="button" data-pagamento="na_entrega" aria-pressed="false">Pagar na entrega</button>');
      const botao = el("pagamento-entrega").lastElementChild;
      botao.addEventListener("click", () => selecionarPagamento(botao.dataset.pagamento, el("pagamento-entrega")));
    }
    el("entrega-teste").addEventListener("input", ctx.agendarCotacaoFrete);
    el("entrega-teste").addEventListener("change", ctx.agendarCotacaoFrete);
    new MutationObserver(ctx.atualizarTextoFrete).observe(el("total"), { childList: true, characterData: true, subtree: true });
    if (!ctx.entrega) {
      el("entrega-teste").hidden = true;
      el("entrega-teste").disabled = true;
    }
  }
  const pagamentoMesa = ctx.p_mesa && !ctx.creditoTeste && !ctx.creditoQuiosque;
  if (pagamentoMesa) {
    el("pagamento-mesa").hidden = false;
    el("pagamento-mesa").disabled = false;
    el("opcao-pix-mesa").hidden = !ctx.pixDisponivel;
    el("pagamento-padrao").hidden = true;
  }
  if (ctx.entrega) {
    el("pagamento-padrao").hidden = true;
    ctx.formaPagamento = "online";
    atualizarPagamento();
  }
  el("pedido").hidden = false;
  el("vitrine").hidden = false;
  el("barra-cardapio").hidden = false;
}
