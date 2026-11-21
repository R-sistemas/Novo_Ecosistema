const cabecalho = ["Confirmação (ISO 8601)","Referência","Canal","Meio","Provedor","Bruto (centavos)",
  "Frete (centavos)","Taxa (centavos)","Líquido (centavos)","Estado do pedido","Estado PSP"];

function celula(valor) {
  const texto = String(valor ?? "");
  const seguro = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(texto) ? "'" + texto : texto;
  return '"' + seguro.replaceAll('"','""') + '"';
}

export function csvFinanceiro(transacoes) {
  const linhas = transacoes.map(t => [t.confirmado_em,t.referencia,t.canal,t.meio,t.provedor,t.valor_centavos,
    t.frete_centavos,t.taxa_centavos,t.liquido_centavos,t.estado,t.estado_psp]);
  return "\uFEFF" + [cabecalho,...linhas].map(linha => linha.map(celula).join(",")).join("\r\n") + "\r\n";
}
