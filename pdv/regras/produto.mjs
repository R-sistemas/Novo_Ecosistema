import { paraCentavos } from "./moeda.mjs";

export const textosProduto = ["categoria", "descricao", "composicao"];
export const opcoesDeVitrine = ["visivel_cardapio", "preparo_cozinha", "queridinho"];

export function dadosProduto(campos) {
  const codigo = campos.codigo.trim();
  const nome = campos.nome.trim();
  const preco_centavos = paraCentavos(campos.preco);
  if (!codigo || !nome || !Number.isSafeInteger(preco_centavos) || preco_centavos < 1) {
    throw new Error("Informe código, nome e preço válido.");
  }
  const dados = { codigo, nome, preco_centavos, vendido_por_peso: campos.vendido_por_peso };
  for (const campo of textosProduto) dados[campo] = campos[campo].trim() || null;
  for (const campo of opcoesDeVitrine) dados[campo] = !dados.vendido_por_peso && campos[campo];
  return dados;
}
