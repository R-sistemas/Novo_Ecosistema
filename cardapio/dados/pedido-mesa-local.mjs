const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const validade = 12 * 60 * 60 * 1000;
const chave = (loja,mesa) => "cardapio:pedido-mesa:" + loja + ":" + mesa;

export function lerPedidoMesa(loja,mesa) {
  if (!loja || !uuid.test(mesa ?? "")) return null;
  try {
    const registro = JSON.parse(localStorage.getItem(chave(loja,mesa)));
    if (uuid.test(registro?.id ?? "") && Date.now() < registro.ate) return registro.id;
    apagarPedidoMesa(loja,mesa);
  } catch { /* o link direto de acompanhamento segue disponível */ }
  return null;
}

export function guardarPedidoMesa(loja,mesa,id) {
  if (!loja || !uuid.test(mesa ?? "") || !uuid.test(id ?? "")) return;
  try { localStorage.setItem(chave(loja,mesa),JSON.stringify({id,ate:Date.now() + validade})); }
  catch { /* armazenamento pode estar indisponível */ }
}

export function apagarPedidoMesa(loja,mesa) {
  try { localStorage.removeItem(chave(loja,mesa)); }
  catch { /* armazenamento pode estar indisponível */ }
}
