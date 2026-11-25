export function preencherSeletorLojas(seletor, lojas, escolhida = "") {
  const escolha = new Option("Escolher estabelecimento", "");
  escolha.disabled = true;
  seletor.replaceChildren(escolha, ...lojas.map(loja => new Option(loja.nome, loja.id)));
  seletor.value = escolhida;
}
