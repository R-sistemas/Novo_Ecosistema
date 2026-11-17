import { saldo } from "../../caixa.mjs";
import { detalhePesagem } from "../../pesagem.mjs";

export function configurarRenderizacao(ctx) {
  const {
    el,
    reais,
    botao,
    estado,
    carrinho,
    pixFrente,
    opcoesPagamento,
    temItens,
    precoAdicional,
    subtotal,
    total,
    desconto,
    renderizarProdutos,
    abrirPesagem,
  } = ctx;
  function renderizar() {
    const sessao = estado.sessao;
    el("status").textContent = sessao ? "Caixa aberto" : "Caixa fechado";
    el("terminal-pdv").disabled = Boolean(sessao);
    el("balance").textContent = sessao
      ? "Dinheiro esperado: " + reais(saldo(sessao))
      : "Abra o caixa para registrar vendas.";
    el("amount-label").textContent = sessao ? "Valor da movimentação ou dinheiro contado" : "Saldo inicial em dinheiro";
    el("cash-actions").replaceChildren(
      ...(sessao ? ["Suprimento", "Sangria", "Fechar caixa"] : ["Abrir caixa"]).map((acao) =>
        botao(acao, () => ctx.operarCaixa(acao), acao !== "Abrir caixa"),
      ),
    );
    el("mesa-frente").textContent = ctx.comandaAberta()?.mesa ?? "Balcão";
    el("cliente-frente").textContent = ctx.comandaAberta()?.cliente ?? "Consumidor";
    el("comanda-frente").textContent = ctx.comandaAberta()?.comanda ?? "—";
    const pixAtivo = pixFrente.atual();
    el("retomar-pix-frente").hidden = !sessao || (!ctx.ambientePixFrente() && !pixAtivo);
    el("retomar-pix-frente").textContent = pixAtivo ? "Ver QR Code em aberto" : "Retomar Pix em aberto";
    const outroPix = ctx.comandaAberta()?.pix_presencial_pendente && !pixAtivo;
    el("status-ajuste-frente").hidden = !ctx.comandaAberta()?.ajuste_pendente && !outroPix;
    el("status-ajuste-frente").textContent = outroPix
      ? "Comanda com cobrança Pix em aberto"
      : ctx.comandaAberta()?.cancelamento_pendente
        ? "Cancelamento aguardando o gestor"
        : "Aguardando resolução de ajuste";
    el("titulo-venda-frente").textContent = ctx.comandaAberta() ? "Itens da comanda" : "Itens da venda";
    el("voltar-balcao").hidden = !ctx.comandaAberta();
    const ajustePendente = ctx.comandaAberta()?.ajuste_pendente || outroPix;
    el("empresa").disabled = Boolean(pixAtivo);
    el("abrir-comandas").disabled =
      el("voltar-balcao").disabled =
      el("abrir-cancelamentos-caixa").disabled =
        Boolean(pixAtivo);
    el("search").disabled = Boolean(ctx.adicionalPendente() || ajustePendente || pixAtivo);
    el("quantidade-frente").disabled = Boolean(ctx.adicionalPendente() || ajustePendente || pixAtivo);
    el("abrir-produtos").disabled = Boolean(
      ctx.adicionalPendente() || ctx.vendaPendente() || ajustePendente || pixAtivo,
    );
    el("desconto-frente").hidden = Boolean(ctx.comandaAberta()) || !ctx.empresasGerenciadas().has(el("empresa").value);
    el("valor-desconto").disabled = Boolean(ctx.vendaPendente() || pixAtivo);
    el("cart-vazio").hidden = temItens();
    const itensBase = pixAtivo?.itens ?? ctx.comandaAberta()?.itens ?? [];
    const itens = [
      ...itensBase.map((item) => ({
        ...item,
        codigo: ctx.produtos().find((p) => p.id === item.produto_id)?.codigo ?? "—",
        preco: item.preco_centavos,
        original: true,
      })),
      ...ctx
        .produtos()
        .filter((p) => !pixAtivo?.itens && carrinho.has(p.codigo))
        .map((p) => ({
          ...p,
          preco: precoAdicional(p),
          nome: ctx.comandaAberta() ? "Adicional · " + p.nome : p.nome,
          quantidade: carrinho.get(p.codigo),
        })),
    ];
    el("cart").replaceChildren(
      ...itens.map((produto) => {
        const { quantidade } = produto;
        const linha = document.createElement("tr");
        const medida = produto.pesagem ? detalhePesagem(produto.pesagem) : quantidade;
        const unitario = produto.pesagem
          ? produto.pesagem.preco_quilo_centavos
            ? reais(produto.pesagem.preco_quilo_centavos) + "/kg"
            : "—"
          : reais(produto.preco);
        for (const texto of [produto.codigo, produto.nome, medida, unitario, reais(produto.preco * quantidade)]) {
          linha.insertCell().textContent = texto;
        }
        const acoes = linha.insertCell();
        if (produto.original) {
          if (produto.pesagem && estado.sessao && !ajustePendente && !pixAtivo)
            acoes.append(botao("Retirar", () => abrirPesagem(produto), true));
          else acoes.textContent = "—";
          return linha;
        }
        const remover = botao(
          "−",
          () => {
            if (ctx.vendaPendente() || ctx.adicionalPendente() || pixFrente.atual()) return;
            if (quantidade === 1) carrinho.delete(produto.codigo);
            else carrinho.set(produto.codigo, quantidade - 1);
            renderizar();
          },
          true,
        );
        remover.setAttribute("aria-label", "Remover uma unidade de " + produto.nome);
        acoes.append(remover);
        return linha;
      }),
    );
    el("salvar-adicionais").hidden = !ctx.comandaAberta() || !carrinho.size;
    el("salvar-adicionais").disabled = !estado.sessao || Boolean(ajustePendente || pixAtivo);
    el("salvar-adicionais").textContent = ctx.adicionalPendente()
      ? "Tentar envio dos adicionais novamente"
      : "Enviar adicionais da comanda";
    atualizarTotalFrente();
    const ultimo = estado.fechamentos.at(-1);
    el("closing").textContent = ultimo
      ? "Último fechamento · esperado " +
        reais(ultimo.esperado) +
        " · contado " +
        reais(ultimo.contado) +
        " · diferença " +
        reais(ultimo.contado - ultimo.esperado)
      : "";
    const historico = sessao?.movimentos ?? ultimo?.movimentos ?? [];
    el("history").replaceChildren(
      ...historico
        .slice(-8)
        .reverse()
        .map((registro) => {
          const linha = document.createElement("li");
          linha.textContent =
            registro.tipo + " · " + reais(registro.valor) + (registro.meio ? " · " + registro.meio : "");
          return linha;
        }),
    );
    if (!historico.length) el("history").textContent = "Nenhum registro neste caixa.";
    renderizarProdutos();
  }

  function atualizarTotalFrente() {
    el("subtotal-frente").textContent = reais(subtotal());
    el("total").textContent = reais(total());
    const recebido = el("valor-recebido-frente").valueAsNumber;
    const recebidoCentavos = Math.round(recebido * 100);
    el("troco-frente").textContent = reais(
      Number.isFinite(recebidoCentavos) ? Math.max(0, recebidoCentavos - total()) : 0,
    );
    const comandaBloqueada =
      ctx.comandaAberta() &&
      (carrinho.size ||
        ctx.comandaAberta().adicionais_pendentes ||
        ctx.comandaAberta().ajuste_pendente ||
        ctx.comandaAberta().pix_presencial_pendente);
    const pixAtivo = pixFrente.atual();
    const podeReceber =
      estado.sessao &&
      !comandaBloqueada &&
      !ctx.adicionalPendente() &&
      !pixAtivo &&
      temItens() &&
      total() > 0 &&
      desconto() >= 0;
    for (const opcao of opcoesPagamento) {
      opcao.disabled = Boolean(
        ctx.vendaPendente() || pixAtivo || (opcao.dataset.meioPdv === "Pix" && ctx.ambientePixFrente() && !podeReceber),
      );
    }
    el("finish").hidden = Boolean(pixAtivo || (ctx.meioSelecionado() === "Pix" && ctx.ambientePixFrente()));
    el("finish").disabled =
      !podeReceber ||
      !ctx.meioSelecionado() ||
      el("finish").hidden ||
      (ctx.meioSelecionado() === "Dinheiro" && Number.isFinite(recebidoCentavos) && recebidoCentavos < total());
  }
  el("valor-desconto").oninput = atualizarTotalFrente;
  el("valor-recebido-frente").oninput = atualizarTotalFrente;

  return { renderizar, atualizarTotalFrente };
}
