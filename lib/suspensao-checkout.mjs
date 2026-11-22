export const codigoSuspensao = "P0751";
export const lojaFechada = "Loja fechada para novos pedidos.";

export function responderLojaFechada(res) {
  return res.status(409).json({ erro: lojaFechada, codigo: "loja_fechada" });
}
