import { dadosProduto, opcoesDeVitrine, textosProduto } from "../../pdv/regras/produto.mjs";
import { paraReais } from "../../pdv/regras/moeda.mjs";
import { otimizarImagem } from "../../imagens-cardapio.mjs";

export function prepararEditor(dialogo, aoSalvar) {
  const form = dialogo.querySelector("form");
  const { elements: el } = form;
  const salvar = form.querySelector('[type="submit"]');
  const cancelar = form.querySelector('[type="button"]');
  const erro = dialogo.querySelector('[role="alert"]');
  let produtoId;

  function modo() {
    const pesado = el.modo.value === "peso";
    form.querySelector("[data-preco]").textContent = pesado ? "Preço por quilo (R$)" : "Preço unitário (R$)";
    for (const campo of opcoesDeVitrine) {
      el[campo].disabled = pesado;
      if (pesado) el[campo].checked = false;
    }
  }

  el.modo.addEventListener("change", modo);
  cancelar.addEventListener("click", () => dialogo.close());
  dialogo.addEventListener("cancel", evento => {
    if (salvar.disabled) evento.preventDefault();
  });
  form.addEventListener("submit", async evento => {
    evento.preventDefault();
    if (salvar.disabled) return;
    salvar.disabled = cancelar.disabled = true;
    erro.textContent = "";
    try {
      const dados = dadosProduto({
        codigo: el.codigo.value, nome: el.nome.value, preco: el.preco.valueAsNumber,
        vendido_por_peso: el.modo.value === "peso",
        ...Object.fromEntries(textosProduto.map(campo => [campo, el[campo].value])),
        ...Object.fromEntries(opcoesDeVitrine.map(campo => [campo, el[campo].checked]))
      });
      dados.ativo = el.ativo.checked;
      if (el.foto.files[0]) dados.foto_cardapio = await otimizarImagem(el.foto.files[0]);
      else if (el.remover_foto.checked) dados.foto_cardapio = null;
      await aoSalvar(produtoId, dados);
      dialogo.close();
    } catch (falha) {
      erro.textContent = falha.message;
    } finally {
      salvar.disabled = cancelar.disabled = false;
    }
  });

  return produto => {
    produtoId = produto?.id ?? null;
    form.reset();
    erro.textContent = "";
    dialogo.querySelector("h2").textContent = produto ? "Editar produto" : "Novo produto";
    if (produto) {
      for (const campo of ["codigo", "nome", ...textosProduto]) el[campo].value = produto[campo] ?? "";
      for (const campo of ["ativo", ...opcoesDeVitrine]) el[campo].checked = produto[campo];
      el.preco.value = paraReais(produto.preco_centavos);
      el.modo.value = produto.vendido_por_peso ? "peso" : "unidade";
    }
    el.remover_foto.disabled = !produto;
    modo();
    dialogo.showModal();
  };
}
