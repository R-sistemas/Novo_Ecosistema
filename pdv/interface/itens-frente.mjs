import { ajustarItemPesado } from "../dados/comandas.mjs";
import { quantidadeValida } from "../regras/quantidade.mjs";

export function configurarItensFrente(ctx) {
  const { el, carrinho, pixFrente, estado, pesagem, dialogoPesagem, reais, renderizar } = ctx;
  let itemPesagem;
  let tentativaPesagem;
  function adicionarProduto(produto) {
    if (
      ctx.vendaPendente() ||
      ctx.adicionalPendente() ||
      pixFrente.atual() ||
      ctx.comandaAberta()?.ajuste_pendente ||
      ctx.comandaAberta()?.pix_presencial_pendente
    )
      return;
    if (produto.vendido_por_peso) {
      abrirPesagem(produto);
      return;
    }
    const quantidade = el("quantidade-frente").valueAsNumber;
    const soma = (carrinho.get(produto.codigo) ?? 0) + quantidade;
    if (!quantidadeValida(quantidade, soma, ctx.comandaAberta() ? 100 : 1000)) {
      el("notice").textContent = "Informe uma quantidade válida. Em adicionais, o limite é 100 por produto.";
      return;
    }
    carrinho.set(produto.codigo, soma);
    el("quantidade-frente").value = "1";
    el("search").value = "";
    renderizar();
  }

  function abrirPesagem(produto) {
    if (
      !estado.sessao ||
      !ctx.comandaAberta() ||
      ctx.comandaAberta().ajuste_pendente ||
      ctx.comandaAberta().pix_presencial_pendente ||
      pixFrente.atual()
    ) {
      el("notice").textContent = "Abra o caixa e uma comanda de mesa para lançar este produto.";
      return;
    }
    itemPesagem = { produto, pedido: ctx.comandaAberta().id };
    const retirar = Boolean(produto.pesagem);
    el("titulo-pesagem").textContent = retirar ? "Retirar lançamento" : "Adicionar produto por peso";
    el("produto-pesagem").textContent =
      produto.nome + " · " + (retirar ? reais(produto.preco) : reais(produto.preco) + "/kg");
    el("retirada-pesagem").hidden = !retirar;
    el("motivo-pesagem").disabled = !retirar;
    el("motivo-pesagem").value = "";
    el("aviso-pesagem").textContent = "";
    pesagem.abrir(retirar ? null : produto.preco);
    dialogoPesagem.showModal();
  }

  el("fechar-pesagem").onclick = () => dialogoPesagem.close();
  el("form-pesagem").onsubmit = async (evento) => {
    evento.preventDefault();
    if (dialogoPesagem.inert) return;
    const { produto, pedido } = itemPesagem;
    const retirada = produto.pesagem?.id;
    const dados = {
      p_empresa: el("empresa").value,
      p_pedido: pedido,
      p_caixa: estado.sessao.id,
      p_produto: retirada ? null : produto.id,
      p_retirar: retirada ?? null,
      p_motivo: retirada ? el("motivo-pesagem").value.trim() : "Lançamento no caixa",
      ...(retirada ? { p_gramas: null, p_valor: null } : pesagem.dados()),
    };
    const chave = JSON.stringify(dados);
    if (tentativaPesagem?.chave !== chave) tentativaPesagem = { chave, id: crypto.randomUUID() };
    dialogoPesagem.inert = true;
    try {
      await ajustarItemPesado({ ...dados, p_id: tentativaPesagem.id });
      tentativaPesagem = undefined;
      await ctx.carregarComandas();
      dialogoPesagem.close();
      el("notice").textContent = retirada ? "Lançamento retirado da comanda." : "Produto lançado na comanda.";
    } catch (erro) {
      el("aviso-pesagem").textContent = erro.message;
    } finally {
      dialogoPesagem.inert = false;
    }
  };

  return { adicionarProduto, abrirPesagem };
}
