export function carregarDados(slug) {
  const chaveDados = "checkout-entrega:" + slug + ":dados";
  let dadosSalvos = null;
  try {
    const anterior = JSON.parse(localStorage.getItem(chaveDados) || "null");
    if (anterior && typeof anterior.nome === "string" && typeof anterior.telefone === "string" &&
      Number.isFinite(anterior.pino?.latitude) && Number.isFinite(anterior.pino?.longitude)) dadosSalvos = anterior;
  } catch { /* O checkout também funciona sem armazenamento local. */ }
  return dadosSalvos;
}

export function salvarDados(slug, estado) {
  const chaveDados = "checkout-entrega:" + slug + ":dados";
  try {
    if (estado.lembrar) localStorage.setItem(chaveDados, JSON.stringify({
      nome: estado.nome.trim(), telefone: estado.telefone.trim(), pino: estado.pino, endereco: estado.endereco
    }));
    else localStorage.removeItem(chaveDados);
  } catch { /* Armazenamento indisponível não impede o pedido. */ }
}
