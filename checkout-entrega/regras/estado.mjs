export function criarEstadoCheckout(dadosSalvos) {
  return {
    etapa: 0,
    pino: dadosSalvos?.pino || null,
    frete: null,
    cotacaoPino: null,
    modalidade: null,
    metodo: null,
    nome: dadosSalvos?.nome || "",
    telefone: dadosSalvos?.telefone || "",
    troco: "",
    endereco: dadosSalvos?.endereco || {},
    lembrar: Boolean(dadosSalvos),
    ocupado: false,
    tentativa: null
  };
}
