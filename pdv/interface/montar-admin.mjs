import { configurarCatalogoAdmin } from "./catalogo-admin.mjs";
import { configurarOperadores } from "./operadores.mjs";
import { configurarAparencia } from "./aparencia.mjs";
import { configurarEdicaoProduto } from "./edicao-produto.mjs";
import { abrirAdmin, modalAdminAtivo } from "../../administracao.mjs";

export function montarAdmin(ctx) {
  const { el, botao, reais, operar, atualizar } = ctx;
  const editarProduto = configurarEdicaoProduto({ el, operar, atualizar });
  const carregarAparencia = configurarAparencia({ el, operar, modalAdminAtivo });
  const renderizarCatalogoAdmin = configurarCatalogoAdmin({
    el,
    botao,
    reais,
    operar,
    atualizar,
    catalogoAdmin: ctx.catalogoAdmin,
    editarProduto,
    abrirAdmin,
  });
  const carregarOperadores = configurarOperadores({ el, botao, operar, atualizar });
  for (const acao of document.querySelectorAll("[data-admin-abrir]")) {
    acao.onclick = () => {
      const id = acao.dataset.adminAbrir;
      if (id === "cadastro-produto") editarProduto();
      abrirAdmin(id);
      if (id === "lista-operadores") void carregarOperadores();
      if (id === "permissao-kds") void carregarOperadores(true);
    };
  }
  return { renderizarCatalogoAdmin, carregarOperadores, carregarAparencia, editarProduto };
}
