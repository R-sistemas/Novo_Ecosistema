export const quantidadeValida = (quantidade, soma, limite) =>
  Number.isInteger(quantidade) && quantidade >= 1 && soma <= limite;
