export const paraCentavos = reais => Math.round(reais * 100);
export const paraReais = centavos => centavos / 100;

export const centavosPorPeso = (precoQuiloCentavos, gramas) => Math.round(precoQuiloCentavos * gramas / 1000);
