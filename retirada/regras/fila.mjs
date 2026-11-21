export function tempoDesdePedido(criadoEm, agora = Date.now()) {
  const minutos = Math.max(0,Math.floor((agora - Date.parse(criadoEm)) / 60000));
  return minutos < 1 ? "Há menos de 1 min" : "Há " + minutos + " min";
}
