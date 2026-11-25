export function lojaInicial(lojas, solicitada) {
  if (solicitada) return lojas.find(loja => loja.id === solicitada)?.id ?? "";
  return lojas.length === 1 ? lojas[0].id : "";
}
