const el = id => document.getElementById(id);
const reais = valor => (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalizar = texto => texto.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "");
function no(tag, texto = "", classe = "") {
  const elemento = document.createElement(tag);
  elemento.textContent = texto;
  elemento.className = classe;
  return elemento;
}
function foto(produto) {
  if (!produto.foto) return no("span", "◇", "sem-foto");
  const imagem = no("img");
  imagem.src = "/api/foto-cardapio?" + new URLSearchParams({ id: produto.id, v: produto.foto });
  imagem.alt = "";
  imagem.loading = "lazy";
  imagem.decoding = "async";
  return imagem;
}
function botao(texto, acao, classe, rotulo) {
  const elemento = no("button", texto, classe);
  elemento.type = "button";
  elemento.onclick = acao;
  if (rotulo) elemento.setAttribute("aria-label", rotulo);
  return elemento;
}

export function montarVitrine(produtos) {
  const quantidades = new Map();
  const qtd = produto => quantidades.get(produto.id) ?? 0;
  const total = () => produtos.reduce((soma, produto) => soma + qtd(produto) * produto.preco_centavos, 0);
  const grupos = new Map();
  let filtro = "";
  for (const produto of produtos) {
    const categoria = produto.categoria?.trim() || "Produtos";
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(produto);
  }

  function atualizarCarrinho() {
    const quantidade = [...quantidades.values()].reduce((a,b) => a + b, 0);
    el("contador").textContent = quantidade ? "(" + quantidade + ")" : "";
    el("guia-carrinho").hidden = !quantidade;
    el("total-barra").textContent = reais(total());
    el("total").textContent = "Total · " + reais(total());
    el("enviar-pedido").disabled = !quantidade;
    el("itens-carrinho").replaceChildren(...produtos.filter(p => qtd(p)).map(p => {
      const linha = no("div", "", "linha linha-pedido");
      const controles = no("div", "", "quantidade");
      controles.append(botao("−", () => alterar(p,-1), "secundario", "Retirar " + p.nome),
        no("strong", String(qtd(p))), botao("+", () => alterar(p,1), "secundario", "Adicionar " + p.nome));
      linha.append(no("span", p.nome + " · " + reais(p.preco_centavos * qtd(p))), controles);
      return linha;
    }));
    if (!quantidade) el("itens-carrinho").textContent = "Seu pedido está vazio.";
  }
  function alterar(produto, delta) {
    const quantidade = Math.max(0, Math.min(100, qtd(produto) + delta));
    if (quantidade) quantidades.set(produto.id, quantidade);
    else quantidades.delete(produto.id);
    atualizarCarrinho();
    if (delta > 0 && !el("carrinho-cardapio").open) {
      const ver = el("ver-pedido");
      ver.classList.remove("guiado");
      requestAnimationFrame(() => requestAnimationFrame(() => ver.classList.add("guiado")));
    }
  }
  function abrirDetalhe(produto) {
    let quantidade = 1;
    const atualizar = () => {
      el("detalhe-quantidade").textContent = quantidade;
      el("detalhe-menos").disabled = quantidade === 1;
      el("detalhe-mais").disabled = quantidade === 100;
      el("detalhe-adicionar").textContent = "Adicionar · " + reais(quantidade * produto.preco_centavos);
    };
    el("detalhe-nome").textContent = produto.nome;
    el("detalhe-foto").replaceChildren(foto(produto));
    el("detalhe-preco").textContent = reais(produto.preco_centavos);
    el("detalhe-descricao").textContent = produto.descricao ?? "";
    el("detalhe-composicao").textContent = produto.composicao ? "Composição · " + produto.composicao : "";
    el("detalhe-menos").onclick = () => { quantidade--; atualizar(); };
    el("detalhe-mais").onclick = () => { quantidade++; atualizar(); };
    el("detalhe-adicionar").onclick = () => { el("detalhe").close(); alterar(produto, quantidade); };
    atualizar();
    el("detalhe").showModal();
  }
  function cartao(produto) {
    const item = no("article", "", "item");
    const nome = Array.from(produto.nome);
    const titulo = no("h3", nome.length > 32 ? nome.slice(0, 31).join("").trimEnd() + "…" : produto.nome);
    const legenda = no("div", "", "legenda");
    legenda.append(titulo);
    const detalhes = botao("", () => abrirDetalhe(produto), "produto-detalhe", "Ver detalhes de " + produto.nome);
    detalhes.append(foto(produto), legenda);
    const rodape = no("div", "", "rodape-produto");
    rodape.append(no("strong", reais(produto.preco_centavos)), botao("+", () => alterar(produto, 1), "mais", "Adicionar " + produto.nome));
    item.append(detalhes, rodape);
    return item;
  }
  const destaques = produtos.filter(p => p.queridinho).slice(0, 3);
  el("destaques").append(...destaques.map(cartao));
  const filtros = [["", "Todos"], ...[...grupos.keys()].map(categoria => [categoria,categoria])];
  const botoes = filtros.map(([id,nome]) => botao(nome, () => { filtro = id; renderizar(); }));
  el("categorias").append(...botoes);
  function renderizar() {
    const busca = normalizar(el("busca-cardapio").value.trim());
    el("secao-destaques").hidden = !destaques.length || Boolean(busca || filtro);
    botoes.forEach((item,i) => item.setAttribute("aria-pressed", String(filtros[i][0] === filtro)));
    el("produtos").replaceChildren(...[...grupos].flatMap(([categoria,itens]) => {
      if (filtro && filtro !== categoria) return [];
      const visiveis = itens.filter(p => normalizar(p.nome + " " + (p.descricao ?? "")).includes(busca));
      if (!visiveis.length) return [];
      const secao = no("section", "", "grupo-categoria");
      const faixa = no("div", "", "faixa");
      faixa.tabIndex = 0;
      faixa.setAttribute("role", "region");
      faixa.setAttribute("aria-label", categoria);
      faixa.append(...visiveis.map(cartao));
      secao.append(no("h3", categoria), faixa);
      return [secao];
    }));
    if (!el("produtos").children.length) el("produtos").textContent = "Nenhum produto encontrado.";
  }
  el("busca-cardapio").oninput = () => { filtro = ""; renderizar(); };
  el("inicio-cardapio").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
  el("categorias-cardapio").onclick = () => el("catalogo").scrollIntoView({ behavior: "smooth" });
  el("ver-pedido").onclick = () => {
    el("ver-pedido").classList.remove("guiado");
    el("passo-pedido").classList.add("guiado");
    el("carrinho-cardapio").showModal();
  };
  el("fechar-carrinho").onclick = () => el("carrinho-cardapio").close();
  el("fechar-detalhe").onclick = () => el("detalhe").close();
  renderizar();
  atualizarCarrinho();
  return {
    total,
    itens: () => [...quantidades].map(([produto_id, quantidade]) => ({ produto_id, quantidade }))
  };
}
