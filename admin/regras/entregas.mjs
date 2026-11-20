import { meiaNoiteSP, periodo } from "./periodo.mjs";

const dataHora = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"});
export const horarioEntrega = data => dataHora.format(new Date(data));

export function filtrosEntregas({inicio,fim,estado,busca}) {
  const faixa = inicio || fim ? periodo("personalizado",inicio,fim) : {};
  return {
    ...(faixa.inicio && {inicio:meiaNoiteSP(faixa.inicio),fim:meiaNoiteSP(faixa.fim)}),
    ...(estado && {estado}),
    ...(busca.trim() && {busca:busca.trim()})
  };
}
