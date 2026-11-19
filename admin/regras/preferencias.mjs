export const fundos = ["#f4f6f2","#ffffff","#f1f3f5","#f8f4eb"];
export const imagens = { cardapio_logo:44000, cardapio_agradecimento:82000 };
const coordenadas = ["mapa_centro_latitude","mapa_centro_longitude"];
const comuns = ["cardapio_cor","cardapio_fundo","pagamento_na_entrega",...Object.keys(imagens)];

export function validarPreferencias(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados) ||
      !Object.keys(dados).length || Object.keys(dados).some(c => !comuns.includes(c) && !coordenadas.includes(c))) {
    throw new Error("Confira os campos das preferências.");
  }
  if ("cardapio_cor" in dados && (typeof dados.cardapio_cor !== "string" || !/^#[\da-f]{6}$/i.test(dados.cardapio_cor))) {
    throw new Error("A cor principal deve estar no formato #RRGGBB.");
  }
  if ("cardapio_fundo" in dados && !fundos.includes(dados.cardapio_fundo)) throw new Error("Escolha um fundo da lista.");
  for (const [campo,limite] of Object.entries(imagens)) {
    if (!(campo in dados) || dados[campo] === null) continue;
    const imagem = dados[campo];
    if (typeof imagem !== "string" || imagem.length > limite || !/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(imagem)) {
      throw new Error("A imagem precisa ser WebP e respeitar o limite do campo.");
    }
  }
  if (coordenadas.some(c => c in dados)) {
    const [lat,lng] = coordenadas.map(c => dados[c]);
    if (!(lat === null && lng === null) &&
        !(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180)) {
      throw new Error("Informe latitude de −90 a 90 e longitude de −180 a 180, ou limpe as duas.");
    }
  }
  if ("pagamento_na_entrega" in dados && typeof dados.pagamento_na_entrega !== "boolean") {
    throw new Error("Confira a opção de pagamento na entrega.");
  }
  return dados;
}

export function alteracoesPreferencias(original,rascunho) {
  const dados = Object.fromEntries(comuns.filter(c => original[c] !== rascunho[c]).map(c => [c,rascunho[c]]));
  if (coordenadas.some(c => original[c] !== rascunho[c])) {
    for (const campo of coordenadas) dados[campo] = rascunho[campo];
  }
  return Object.keys(dados).length ? validarPreferencias(dados) : dados;
}
