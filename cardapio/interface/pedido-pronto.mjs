export function prepararPedidoPronto(ctx) {
  const destaque = document.getElementById("pedido-pronto");
  const identificacao = document.getElementById("identificacao-retirada");
  const orientacao = document.getElementById("orientacao-pedido-mesa");
  let audio, anterior, avisou, consultaPermissao = false;

  function prepararSom() {
    if (!ctx.p_mesa) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      if (audio.state === "suspended") void audio.resume().catch(() => {});
    } catch { /* aviso visual disponível */ }
  }

  function tocar() {
    if (audio?.state !== "running") return;
    try {
      const oscilador = audio.createOscillator();
      const volume = audio.createGain();
      const inicio = audio.currentTime;
      oscilador.frequency.value = 880;
      volume.gain.setValueAtTime(0.001,inicio);
      volume.gain.exponentialRampToValueAtTime(0.15,inicio + 0.04);
      volume.gain.exponentialRampToValueAtTime(0.001,inicio + 0.42);
      oscilador.connect(volume).connect(audio.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + 0.45);
    } catch { /* aviso visual disponível */ }
  }

  function confirmar() {
    anterior ??= "novo";
    if (!ctx.p_mesa || consultaPermissao || window.Notification?.permission !== "default") return;
    consultaPermissao = true;
    try { void Notification.requestPermission().catch(() => {}); }
    catch { /* aviso visual e sonoro continuam disponíveis */ }
  }

  async function notificar(pedido) {
    if (window.Notification?.permission !== "granted") return;
    const opcoes = {body:"Comanda " + pedido.comanda + " · Mesa " + pedido.mesa};
    try {
      new Notification("Pedido pronto",opcoes);
    } catch {
      try {
        const registro = await navigator.serviceWorker?.getRegistration();
        await registro?.showNotification("Pedido pronto",opcoes);
      } catch { /* aviso dentro da página disponível */ }
    }
  }

  function atualizar(pedido) {
    const mesa = pedido.mesa != null && !pedido.cancelado;
    const pronto = mesa && pedido.estado === "pronto";
    orientacao.hidden = !mesa || !ctx.acompanhamentoAtivo || pronto || pedido.estado === "entregue" || pedido.estado === "recusado";
    destaque.hidden = !pronto;
    if (pronto) {
      identificacao.textContent = "Comanda " + pedido.comanda + " · Mesa " + pedido.mesa;
      if (!avisou && anterior != null && anterior !== "pronto") {
        avisou = true;
        tocar();
        void notificar(pedido);
      }
    }
    anterior = pedido.estado;
  }

  return {prepararSom,confirmar,atualizar};
}
