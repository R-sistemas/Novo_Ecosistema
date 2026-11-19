const el = id => document.getElementById(id);

export function montarEstrutura() {
  const form = el("pedido");
  const itens = el("itens-carrinho");
  const totalAntigo = el("total");
  const botao = el("enviar-pedido");
  form.replaceChildren();
  const progresso = document.createElement("div");
  progresso.className = "checkout-progresso";
  const conteudo = document.createElement("section");
  conteudo.id = "checkout-conteudo";
  const erro = document.createElement("p");
  erro.id = "erro-pedido";
  erro.setAttribute("role", "alert");
  const voltar = document.createElement("button");
  voltar.type = "button";
  voltar.className = "checkout-voltar";
  voltar.textContent = "← Voltar";
  const passo = document.createElement("p");
  passo.id = "passo-pedido";
  passo.className = "passo";
  form.append(progresso, itens, conteudo, totalAntigo, voltar, passo, botao, erro);
  botao.type = "button";
  form.onsubmit = evento => evento.preventDefault();
  return { form, itens, totalAntigo, botao, progresso, conteudo, erro, voltar, passo };
}
