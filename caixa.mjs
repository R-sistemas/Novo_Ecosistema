export function saldo(sessao) {
  return sessao.movimentos.reduce((total, movimento) => total + movimento.centavos, sessao.abertura);
}

export function movimento(sessao, tipo, centavos, meio = "") {
  if (!sessao || !Number.isSafeInteger(centavos) || centavos <= 0) {
    throw new Error("Abra o caixa e informe um valor válido.");
  }
  const impacto = tipo === "Sangria" ? -centavos :
    tipo === "Venda" && meio !== "Dinheiro" ? 0 : centavos;
  if (saldo(sessao) + impacto < 0) {
    throw new Error("A sangria ultrapassa o saldo em dinheiro.");
  }
  sessao.movimentos.push({ tipo, valor: centavos, centavos: impacto, meio });
}
