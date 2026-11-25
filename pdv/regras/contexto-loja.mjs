let geracao = 0;

export function invalidarContextoLoja() {
  geracao++;
}

export function vigiaDaLoja(seletor) {
  const versao = geracao;
  const loja = seletor.value;
  return () => versao === geracao && loja === seletor.value;
}
