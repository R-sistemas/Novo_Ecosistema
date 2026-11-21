const moeda = new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"});
export const horario = new Intl.DateTimeFormat("pt-BR", {
  dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"
});
export const meios = {pix:"Pix",credito:"Crédito",debito:"Débito"};

export function reais(valor) {
  const centavos = BigInt(valor ?? 0);
  return moeda.formatToParts(centavos / 100n).map(parte =>
    parte.type === "fraction" ? String(centavos % 100n).padStart(2,"0") : parte.value
  ).join("");
}
