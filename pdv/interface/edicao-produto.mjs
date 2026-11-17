import { cadastrarProduto, atualizarProduto } from "../../supabase-pdv.mjs";
import { otimizarImagem } from "../../imagens-cardapio.mjs";

export function configurarEdicaoProduto({ el, operar, atualizar }) {
  let produtoEditado;
  function editarProduto(produto) {
    produtoEditado = produto;
    el("cadastro-produto").reset();
    el("cadastro-produto").querySelector("h2").textContent = produto ? "Editar produto" : "Cadastrar produto";
    el("produto-modo-venda").value = produto?.vendido_por_peso ? "peso" : "unidade";
    if (!produto) {
      configurarModoProduto();
      return;
    }
    el("produto-visivel").checked = produto.visivel_cardapio;
    el("produto-preparo").checked = produto.preparo_cozinha;
    for (const campo of ["codigo", "nome", "categoria", "descricao", "composicao"]) {
      el("produto-" + campo).value = produto[campo] ?? "";
    }
    el("produto-preco").value = produto.preco_centavos / 100;
    el("produto-queridinho").checked = produto.queridinho;
    configurarModoProduto();
  }
  function configurarModoProduto() {
    const pesado = el("produto-modo-venda").value === "peso";
    el("orientacao-produto-peso").hidden = !pesado;
    el("rotulo-produto-preco").textContent = pesado ? "Preço por quilo (R$)" : "Preço unitário (R$)";
    for (const id of ["produto-visivel", "produto-preparo", "produto-queridinho"]) {
      el(id).disabled = pesado;
      if (pesado) el(id).checked = false;
    }
  }
  el("produto-modo-venda").onchange = configurarModoProduto;
  el("cancelar-produto").onclick = () => editarProduto();
  el("cadastro-produto").addEventListener("submit", (evento) => {
    evento.preventDefault();
    operar(async () => {
      const codigo = el("produto-codigo").value.trim();
      const nome = el("produto-nome").value.trim();
      const preco_centavos = Math.round(el("produto-preco").valueAsNumber * 100);
      if (!codigo || !nome || !Number.isSafeInteger(preco_centavos) || preco_centavos < 1) {
        throw new Error("Informe código, nome e preço válido.");
      }
      const empresa = el("empresa").value;
      const foto = el("produto-foto").files[0];
      const dados = {
        codigo,
        nome,
        preco_centavos,
        vendido_por_peso: el("produto-modo-venda").value === "peso",
        visivel_cardapio: el("produto-visivel").checked,
        preparo_cozinha: el("produto-preparo").checked,
        queridinho: el("produto-queridinho").checked,
      };
      for (const campo of ["categoria", "descricao", "composicao"])
        dados[campo] = el("produto-" + campo).value.trim() || null;
      if (foto) dados.foto_cardapio = await otimizarImagem(foto);
      const editando = Boolean(produtoEditado);
      if (editando) await atualizarProduto(empresa, produtoEditado.id, dados);
      else await cadastrarProduto({ empresa_id: empresa, ...dados });
      editarProduto();
      await atualizar();
      return editando ? "Produto atualizado." : "Produto cadastrado.";
    }, true);
  });
  return editarProduto;
}
