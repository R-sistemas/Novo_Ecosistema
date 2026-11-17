import { atualizarProduto } from "../../supabase-pdv.mjs";

export function configurarCatalogoAdmin(ctx) {
  const { el, botao, reais, operar, atualizar } = ctx;
  function renderizarCatalogoAdmin() {
    const busca = el("buscar-produto-admin").value.trim().toLocaleLowerCase("pt-BR");
    const visiveis = ctx
      .catalogoAdmin()
      .filter((p) => [p.nome, p.codigo, p.categoria].join(" ").toLocaleLowerCase("pt-BR").includes(busca));
    el("admin-contagem").textContent = visiveis.length + " de " + ctx.catalogoAdmin().length + " produtos ativos";
    const empresa = el("empresa").value;
    el("catalogo-gestor").replaceChildren(
      ...visiveis.map((produto) => {
        const linha = document.createElement("li");
        const dados = document.createElement("div");
        const nome = document.createElement("strong");
        nome.textContent = produto.nome;
        const detalhe = document.createElement("small");
        detalhe.textContent = [
          produto.codigo,
          produto.categoria,
          reais(produto.preco_centavos) + (produto.vendido_por_peso ? "/kg" : ""),
        ]
          .filter(Boolean)
          .join(" · ");
        dados.append(nome, detalhe);
        const acoes = document.createElement("div");
        acoes.className = "admin-produto-acoes";
        acoes.append(
          botao(
            "Editar",
            () => {
              ctx.editarProduto(produto);
              ctx.abrirAdmin("cadastro-produto");
            },
            true,
          ),
          botao(
            "Desativar",
            () =>
              operar(async () => {
                if (!window.confirm("Retirar " + produto.nome + " do catálogo ativo?")) return "";
                await atualizarProduto(empresa, produto.id, { ativo: false });
                await atualizar();
                return "Produto retirado do catálogo.";
              }),
            true,
          ),
        );
        linha.append(dados, acoes);
        return linha;
      }),
    );
    if (!visiveis.length) {
      const vazio = document.createElement("li");
      vazio.textContent = "Nenhum produto encontrado.";
      el("catalogo-gestor").append(vazio);
    }
  }
  el("buscar-produto-admin").oninput = renderizarCatalogoAdmin;

  return renderizarCatalogoAdmin;
}
