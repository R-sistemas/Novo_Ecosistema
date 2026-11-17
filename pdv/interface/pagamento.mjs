import { registrarVenda } from "../dados/vendas.mjs";

export function configurarPagamento(ctx) {
  const {
    el,
    opcoesPagamento,
    pixFrente,
    estado,
    carrinho,
    meios,
    dialogoPesagem,
    operar,
    total,
    desconto,
    atualizarTotalFrente,
    renderizar,
    atualizar,
    reais,
    receberPedido,
  } = ctx;
  function abrirPagamento(focar = true) {
    el("pagamento-pdv").hidden = false;
    el("abrir-pagamento-pdv").hidden = true;
    if (focar) (ctx.vendaPendente() ? el("finish") : opcoesPagamento[0]).focus();
  }
  function selecionarPagamento(opcao) {
    if (opcao.disabled || ctx.vendaPendente() || pixFrente.atual()) return;
    ctx.setMeioSelecionado(opcao.dataset.meioPdv);
    const pixAutomatico = ctx.meioSelecionado() === "Pix" && ctx.ambientePixFrente();
    el("titulo-pagamento-frente").textContent =
      ctx.meioSelecionado() === "Pix"
        ? pixAutomatico
          ? "Pix automático"
          : "Pix · Conferência no caixa"
        : ctx.meioSelecionado() === "Cartão"
          ? "Cartão · Maquininha"
          : "Dinheiro · Recebimento";
    el("dinheiro-frente").hidden = ctx.meioSelecionado() !== "Dinheiro";
    el("detalhe-pagamento-frente").hidden = false;
    for (const item of opcoesPagamento) {
      item.setAttribute("aria-pressed", String(item === opcao));
      item.classList.toggle("secondary", item !== opcao);
    }
    el("orientacao-frente").textContent =
      ctx.meioSelecionado() === "Pix"
        ? pixAutomatico
          ? "Escolha Pix para gerar uma cobrança."
          : "Confirme o Pix recebido antes de registrar."
        : ctx.meioSelecionado() === "Cartão"
          ? "Confirme a aprovação na maquininha antes de registrar."
          : "Confira o dinheiro recebido antes de registrar.";
    atualizarTotalFrente();
    if (pixAutomatico) {
      void pixFrente.iniciar({
        p_caixa: estado.sessao.id,
        p_pedido: ctx.comandaAberta()?.id ?? null,
        p_total: total(),
        p_desconto: desconto(),
        p_itens: ctx
          .produtos()
          .filter((p) => carrinho.has(p.codigo))
          .map((p) => ({
            produto_id: p.id,
            quantidade: carrinho.get(p.codigo),
          })),
      });
      return;
    }
    el(ctx.meioSelecionado() === "Dinheiro" ? "valor-recebido-frente" : "finish").focus();
  }
  function limparPagamento() {
    ctx.setMeioSelecionado(undefined);
    for (const opcao of opcoesPagamento) {
      opcao.setAttribute("aria-pressed", "false");
      opcao.classList.add("secondary");
    }
    el("pagamento-pdv").hidden = true;
    el("abrir-pagamento-pdv").hidden = false;
    el("orientacao-frente").textContent = "Selecione a forma de pagamento.";
    el("valor-desconto").value = "";
    el("valor-recebido-frente").value = "";
    el("detalhe-pagamento-frente").hidden = true;
  }
  el("abrir-pagamento-pdv").onclick = () => abrirPagamento();
  el("retomar-pix-frente").onclick = () => {
    if (pixFrente.atual()) {
      pixFrente.abrir();
      return;
    }
    void operar(async () => {
      const retomado = await pixFrente.recuperar(true);
      return retomado ? "" : "Nenhum Pix em aberto neste caixa.";
    });
  };
  for (const opcao of opcoesPagamento) opcao.onclick = () => selecionarPagamento(opcao);
  document.addEventListener("keydown", (evento) => {
    if (
      ctx.area() !== "vendas" ||
      el("operacao").hidden ||
      el("dialogo-comandas").open ||
      el("dialogo-produtos").open ||
      el("resolver-ajuste-caixa").open ||
      dialogoPesagem.open ||
      el("dialogo-cancelamentos").open ||
      pixFrente.aberta() ||
      ctx.ocupado() ||
      evento.ctrlKey ||
      evento.altKey ||
      evento.metaKey
    )
      return;
    if (evento.key === "F3") {
      evento.preventDefault();
      abrirPagamento();
    } else if (
      /^[123]$/.test(evento.key) &&
      el("pagamento-pdv").contains(document.activeElement) &&
      !document.activeElement.matches("input")
    ) {
      evento.preventDefault();
      selecionarPagamento(opcoesPagamento[Number(evento.key) - 1]);
    } else if (evento.key === "F4" && !el("pagamento-pdv").hidden) {
      evento.preventDefault();
      if (!el("finish").disabled) el("sale").requestSubmit(el("finish"));
    } else if (evento.key === "F6" && !el("desconto-frente").hidden) {
      evento.preventDefault();
      el("valor-desconto").focus();
    } else if (evento.key === "F7") {
      evento.preventDefault();
      el("abrir-comandas").click();
    } else if (evento.key === "F9") {
      evento.preventDefault();
      el("abrir-produtos").click();
    }
  });
  el("sale").addEventListener("submit", (evento) => {
    evento.preventDefault();
    if (el("finish").disabled) return;
    if (ctx.comandaAberta()) {
      void receberPedido(ctx.comandaAberta().id, ctx.meioSelecionado(), ctx.comandaAberta().total_centavos);
      return;
    }
    operar(async () => {
      if (!ctx.vendaPendente())
        ctx.setVendaPendente({
          p_caixa: estado.sessao.id,
          p_venda: crypto.randomUUID(),
          p_meio: meios[ctx.meioSelecionado()],
          p_desconto: desconto(),
          p_itens: ctx
            .produtos()
            .filter((p) => carrinho.has(p.codigo))
            .map((p) => ({
              produto_id: p.id,
              quantidade: carrinho.get(p.codigo),
            })),
        });
      const valor = await registrarVenda(ctx.vendaPendente());
      ctx.setVendaPendente(undefined);
      carrinho.clear();
      limparPagamento();
      renderizar();
      await atualizar();
      requestAnimationFrame(() => el("search").focus());
      return "Venda registrada · " + reais(valor);
    });
  });
  return { abrirPagamento, limparPagamento };
}
