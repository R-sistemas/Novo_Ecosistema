const status = { sem_classificacao: "Sem classificação", ativa: "Ativa" };
const planos = { basico: "Básico", pro: "Pró" };

const situacoes = {
  em_dia: { texto: "Em dia", cor: "verde" },
  em_debito: { texto: "Em débito", cor: "atencao" },
  bloqueada_parcial: { texto: "Bloqueada parcial", cor: "atencao" },
  bloqueada_total: { texto: "Bloqueada total", cor: "critico" }
};

export function situacaoLicenca(empresa) {
  return situacoes[empresa.situacao] ?? { texto: "—", cor: "cinza" };
}

export const rotuloSuspensao = {
  automatico: "Política automática",
  liberada: "Liberada manualmente",
  suspensa: "Suspensa manualmente"
};

export function resumoLicenca(empresa) {
  const emAtraso = empresa.dias_em_atraso > 0;
  const pagamento = empresa.pagamento === "pago"
    ? { texto: "Pago", cor: "verde" }
    : emAtraso ? { texto: "Em débito", cor: "atencao" } : { texto: "Pendente", cor: "cinza" };
  return {
    estado: status[empresa.estado],
    plano: { texto: planos[empresa.plano] ?? "—", cor: empresa.plano === "pro" ? "verde" : "cinza" },
    vencimento: empresa.vencimento ? empresa.vencimento.split("-").reverse().join("/") : "—",
    pagamento,
    atraso: empresa.dias_em_atraso ?? "—",
    emAtraso
  };
}

export function dadosLicenca(campos, empresa) {
  return {
    id: empresa.id, revisao: empresa.revisao, estado: campos.get("estado"),
    plano: campos.get("plano") || null, preco_centavos: campos.get("preco") === "" ? null : Math.round(Number(campos.get("preco")) * 100),
    vencimento: campos.get("vencimento") || null, pagamento: campos.get("pagamento"), motivo: campos.get("motivo").trim()
  };
}
