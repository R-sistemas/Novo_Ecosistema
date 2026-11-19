export function criarEstadoMonitor() {
  return {
    aba: "pedidos",
    dados: undefined,
    consultando: false,
    encerrando: false,
    consultaAtual: undefined
  };
}
