import { paraCentavos, paraReais } from "../../pdv/regras/moeda.mjs";

export const moeda = valor => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(paraReais(valor));

export function telefoneNacional(valor) {
  let digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) digitos = digitos.slice(2);
  return /^\d{10,11}$/.test(digitos) ? digitos : null;
}

export const montarEndereco = estado => ({
  maps_url: estado.pino.maps_url, latitude: estado.pino.latitude, longitude: estado.pino.longitude,
  ...estado.endereco, telefone: telefoneNacional(estado.telefone),
  metodo_pagamento: ({ cash: "dinheiro", terminal: "maquininha", credit: "credito", pix: "pix" })[estado.metodo],
  troco_para_centavos: estado.metodo === "cash" && estado.troco ? paraCentavos(Number(estado.troco.replace(",", "."))) : null
});
export const montarEnderecoCotacao = estado => ({
  maps_url: estado.pino.maps_url,
  latitude: estado.pino.latitude, longitude: estado.pino.longitude, ...estado.endereco
});

export function trocoInsuficiente(estado, total) {
  return estado.metodo === "cash" && estado.troco && (!Number.isFinite(Number(estado.troco.replace(",", "."))) || paraCentavos(Number(estado.troco.replace(",", "."))) < total);
}
