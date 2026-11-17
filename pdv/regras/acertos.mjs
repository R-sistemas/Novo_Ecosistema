export function validarAcerto({ caixa, acerto, conferido, maquininhaDevolvida }) {
  if (!caixa) throw new Error("Abra o caixa para confirmar o acerto.");
  if (!acerto || !conferido) throw new Error("Confira o valor recebido.");
  if (acerto.metodo === "maquininha" && !maquininhaDevolvida) {
    throw new Error("Confirme a devolução da maquininha.");
  }
}
