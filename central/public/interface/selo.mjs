export function selo({ texto, cor }) {
  const elemento = document.createElement("span");
  elemento.className = "selo " + cor;
  elemento.textContent = texto;
  return elemento;
}
