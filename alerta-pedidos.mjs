export function criarAlertaPedidos(aviso) {
  const indicador = document.createElement("p");
  indicador.setAttribute("role", "status");
  indicador.style.fontWeight = "700";
  const ativador = document.createElement("button");
  ativador.type = "button";
  ativador.className = "secondary";
  ativador.textContent = "Ativar som de novos pedidos";
  aviso.after(ativador, indicador);

  let contexto;
  let empresaAtual;
  let anteriores = new Set();
  let carregado = false;

  function tocar() {
    if (!contexto || contexto.state !== "running") return;
    for (const [deslocamento, frequencia] of [[0, 740], [0.22, 990]]) {
      const oscilador = contexto.createOscillator();
      const volume = contexto.createGain();
      oscilador.type = "sine";
      oscilador.frequency.value = frequencia;
      volume.gain.setValueAtTime(0.0001, contexto.currentTime + deslocamento);
      volume.gain.exponentialRampToValueAtTime(0.12, contexto.currentTime + deslocamento + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.0001, contexto.currentTime + deslocamento + 0.18);
      oscilador.connect(volume).connect(contexto.destination);
      oscilador.start(contexto.currentTime + deslocamento);
      oscilador.stop(contexto.currentTime + deslocamento + 0.19);
    }
  }

  ativador.onclick = async () => {
    if (contexto) {
      await contexto.close();
      contexto = undefined;
      ativador.textContent = "Ativar som de novos pedidos";
      return;
    }
    const TipoAudio = window.AudioContext || window.webkitAudioContext;
    if (!TipoAudio) {
      indicador.textContent = "Este navegador não oferece alerta sonoro.";
      return;
    }
    contexto = new TipoAudio();
    await contexto.resume();
    ativador.textContent = "Desativar som de novos pedidos";
    tocar();
  };

  return {
    atualizar(empresa, pedidos) {
      if (empresaAtual !== empresa) {
        empresaAtual = empresa;
        anteriores = new Set();
        carregado = false;
      }
      const novos = pedidos.filter(pedido => pedido.estado === "novo");
      const ids = new Set(novos.map(pedido => String(pedido.id) + (pedido.adicional ? ":adicional" : "")));
      if (carregado && [...ids].some(id => !anteriores.has(id))) tocar();
      anteriores = ids;
      carregado = true;
      indicador.textContent = novos.length
        ? `${novos.length} ${novos.length === 1 ? "pedido aguardando" : "pedidos aguardando"} início do preparo.`
        : "";
    }
  };
}
