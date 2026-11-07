export function textoDaCor(cor) {
  const rgb = [1, 3, 5].map(i => parseInt(cor.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b > .179 ? "#000" : "#fff";
}

export function aplicarTema(elemento, cor, fundo) {
  const primaria = /^#[0-9a-f]{6}$/i.test(cor ?? "") ? cor : "#175d2d";
  elemento.style.setProperty("--verde", primaria);
  elemento.style.setProperty("--texto-botao", textoDaCor(primaria));
  elemento.style.setProperty("--fundo", fundo || "#f4f6f2");
}
