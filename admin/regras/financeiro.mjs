import { dataValida } from "./periodo.mjs";

export function periodoFinanceiroValido(inicio, fim) {
  return dataValida(inicio) && dataValida(fim) && inicio >= "0001-01-01" &&
    inicio <= fim && Date.parse(fim) - Date.parse(inicio) <= 365 * 86400000;
}
