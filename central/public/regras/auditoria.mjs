const campos = {
  estado: "Estado", plano: "Plano", preco_centavos: "Preço mensal", vencimento: "Vencimento",
  pagamento: "Pagamento", revisao: "Revisão", vencimento_quitado: "Ciclo quitado",
  data_pagamento: "Data do pagamento", valor_centavos: "Valor recebido", modo: "Modo de suspensão",
  nome: "Nome", slug: "Slug", papel: "Papel"
};
const valores = {
  basico: "Básico", pro: "Pró", pago: "Pago", pendente: "Pendente", central: "Central",
  automatico: "Automático", liberada: "Liberada", suspensa: "Suspensa",
  ativa: "Ativa", sem_classificacao: "Sem classificação"
};
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" });

export const formatarDataHora = instante => dataHora.format(new Date(instante));

export function resumirAuditoria(registro) {
  return Object.entries(campos).filter(([chave]) => Object.hasOwn(registro ?? {}, chave))
    .map(([chave, rotulo]) => {
      const valor = registro[chave];
      if (valor === null) return [rotulo, "—"];
      if (chave.endsWith("_centavos")) return [rotulo, moeda.format(valor / 100)];
      if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return [rotulo, valor.split("-").reverse().join("/")];
      return [rotulo, ["estado", "plano", "pagamento", "modo", "papel"].includes(chave)
        && Object.hasOwn(valores, valor) ? valores[valor] : String(valor)];
    });
}
