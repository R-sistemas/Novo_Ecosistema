export function exibirAvisosPedido(status,avisos) {
  let painel = document.getElementById("avisos-pedido");
  if (!avisos.length) {
    painel?.remove();
    return;
  }
  const assinatura = JSON.stringify(avisos);
  if (painel?.dataset.avisos === assinatura) return;
  if (!painel) {
    painel = document.createElement("section");
    painel.id = "avisos-pedido";
    painel.className = "panel";
    painel.setAttribute("aria-live","polite");
    status.after(painel);
  }
  painel.dataset.avisos = assinatura;
  const titulo = document.createElement("h2");
  titulo.textContent = "A cozinha avisou";
  const lista = document.createElement("ul");
  for (const aviso of avisos) {
    const item = document.createElement("li");
    item.textContent = aviso.mensagem;
    lista.append(item);
  }
  painel.replaceChildren(titulo,lista);
}
