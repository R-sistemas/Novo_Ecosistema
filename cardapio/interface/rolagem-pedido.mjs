export function mostrarEtapaPedido(alvo) {
  alvo?.scrollIntoView({ block: "start", inline: "nearest" });
}

export function mostrarDestinoPedido() {
  const pix = document.getElementById("pagamento-pix");
  mostrarEtapaPedido(pix.hidden ? document.getElementById("andamento-pedido") : pix);
}
