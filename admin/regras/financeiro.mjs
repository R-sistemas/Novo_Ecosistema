import { dataValida } from "./periodo.mjs";

export function periodoFinanceiroValido(inicio, fim, maximoDias = 366) {
  return dataValida(inicio) && dataValida(fim) && inicio >= "0001-01-01" &&
    inicio <= fim && Date.parse(fim) - Date.parse(inicio) <= (maximoDias - 1) * 86400000;
}
