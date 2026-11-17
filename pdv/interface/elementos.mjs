export const el = (id) => document.getElementById(id);
export const reais = (centavos) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(centavos / 100);

export function botao(texto, acao, secundario = false) {
  const elemento = document.createElement("button");
  elemento.type = "button";
  elemento.textContent = texto;
  elemento.classList.toggle("secondary", secundario);
  elemento.addEventListener("click", acao);
  return elemento;
}
