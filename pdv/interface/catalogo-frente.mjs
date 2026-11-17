export function configurarCatalogoFrente(ctx) {
  const { el, botao, reais, dialogoPesagem } = ctx;
  function renderizarProdutos() {
    const busca = el("buscar-produto-frente").value.trim().toLocaleLowerCase("pt-BR");
    const grupos = new Map();
    for (const produto of ctx.produtos()) {
      const categoria = produto.categoria?.trim() || "Sem categoria";
      if (![produto.codigo, produto.nome, categoria].join(" ").toLocaleLowerCase("pt-BR").includes(busca)) continue;
      if (!grupos.has(categoria)) grupos.set(categoria, []);
      grupos.get(categoria).push(produto);
    }
    el("products").replaceChildren(
      ...[...grupos].map(([categoria, itens]) => {
        const secao = document.createElement("section");
        const titulo = document.createElement("h3");
        titulo.textContent = categoria;
        const grade = document.createElement("div");
        grade.className = "products";
        grade.append(
          ...itens.map((produto) => {
            const item = botao(
              produto.nome,
              () => {
                el("dialogo-produtos").close();
                ctx.adicionarProduto(produto);
                if (!dialogoPesagem.open) el("search").focus();
              },
              true,
            );
            const detalhe = document.createElement("small");
            detalhe.textContent =
              produto.codigo + " · " + reais(produto.preco) + (produto.vendido_por_peso ? "/kg" : "");
            item.append(detalhe);
            return item;
          }),
        );
        secao.append(titulo, grade);
        return secao;
      }),
    );
    if (!grupos.size) el("products").textContent = "Nenhum produto encontrado.";
  }
  return renderizarProdutos;
}
