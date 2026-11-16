const link = p => `https://www.google.com/maps?q=${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

export function criarLocationPicker({ centro, aoConfirmar, aoAlterar, inicial = null }) {
  const painel = document.createElement("section");
  painel.className = "checkout-mapa-inline";
  painel.innerHTML = `<div class="checkout-mapa-cabecalho"><strong>Localização no mapa <small>OBRIGATÓRIO</small></strong><p>Arraste o pino para o local da entrega. Use dois dedos para ampliar.</p></div>
    <div class="checkout-mapa-acoes"><button type="button" data-acao="gps">◎ Usar minha localização</button></div>
    <div class="checkout-mapa-viewport" role="application" aria-label="Mapa da entrega. Toque para marcar ou arraste o pino."></div>
    <p class="checkout-mapa-feedback" role="status">${inicial ? "Confira o local salvo e confirme o pino." : "Toque no local da entrega ou use sua localização."}</p>
    <button type="button" class="checkout-mapa-confirmar" data-acao="confirmar" ${inicial ? "" : "disabled"}>Confirmar este ponto ✓</button>`;
  const viewport = painel.querySelector(".checkout-mapa-viewport");
  const feedback = painel.querySelector(".checkout-mapa-feedback");
  const confirmar = painel.querySelector('[data-acao="confirmar"]');
  let candidato = inicial ? { latitude: inicial.latitude, longitude: inicial.longitude } : null;
  let vista = candidato || centro;
  let zoom = candidato ? 17 : 15;
  let mapa = null, marcador = null, gpsWatch = null, gpsTimer = null, confirmado = Boolean(inicial);
  function marcar(latlng, alterado = true) {
    candidato = { latitude: Number(latlng.lat.toFixed(6)), longitude: Number(latlng.lng.toFixed(6)) };
    if (alterado) { confirmado = false; aoAlterar?.(); }
    if (marcador) marcador.setLatLng([candidato.latitude, candidato.longitude]);
    else marcador = L.marker([candidato.latitude, candidato.longitude], { draggable: true }).addTo(mapa);
    confirmar.disabled = false;
    confirmar.textContent = confirmado ? "Ponto confirmado ✓" : "Confirmar este ponto ✓";
    feedback.textContent = confirmado ? "Localização confirmada. Você pode ajustar o pino e confirmar novamente." :
      "Ponto selecionado. Ajuste o pino se necessário e confirme para calcular a entrega.";
    marcador.off("dragend");
    marcador.on("dragend", () => marcar(marcador.getLatLng()));
  }
  function pararGps() {
    if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
    if (gpsTimer !== null) clearTimeout(gpsTimer);
    gpsWatch = gpsTimer = null;
  }
  function usarGps() {
    if (!navigator.geolocation) { feedback.textContent = "GPS indisponível. Marque o ponto manualmente."; return; }
    pararGps();
    feedback.textContent = "Buscando posição precisa. Aguarde ou marque manualmente no mapa.";
    gpsWatch = navigator.geolocation.watchPosition(posicao => {
      const { latitude, longitude, accuracy } = posicao.coords;
      if (![latitude, longitude, accuracy].every(Number.isFinite)) return;
      if (accuracy > 100) {
        feedback.textContent = `O aparelho informou precisão aproximada de ${Math.round(accuracy)} m. Aguardando GPS melhor; você pode marcar manualmente.`;
        return;
      }
      pararGps();
      mapa.setView([latitude, longitude], accuracy <= 30 ? 18 : 17);
      marcar({ lat: latitude, lng: longitude });
      feedback.textContent = `GPS com precisão aproximada de ${Math.round(accuracy)} m. Ajuste o pino, se necessário, e confirme.`;
    }, () => {
      pararGps();
      feedback.textContent = "Não foi possível obter GPS preciso. Marque manualmente no mapa.";
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    gpsTimer = setTimeout(() => {
      pararGps();
      feedback.textContent = "O GPS não obteve posição precisa. Marque manualmente no mapa.";
    }, 16000);
  }
  painel.addEventListener("click", evento => {
    const acao = evento.target.closest("[data-acao]")?.dataset.acao;
    if (acao === "gps") usarGps();
    if (acao === "confirmar" && candidato) {
      pararGps();
      confirmado = true;
      confirmar.textContent = "Ponto confirmado ✓";
      feedback.textContent = "Localização confirmada. Você pode ajustar o pino e confirmar novamente.";
      aoConfirmar({ ...candidato, maps_url: link(candidato) });
    }
  });
  return { montar(container) {
    if (mapa) {
      vista = { latitude: mapa.getCenter().lat, longitude: mapa.getCenter().lng };
      zoom = mapa.getZoom();
      mapa.remove();
      mapa = null;
      marcador = null;
    }
    container.append(painel);
    if (!window.L) {
      feedback.textContent = "Não foi possível carregar o mapa. Verifique sua conexão e atualize a página.";
      confirmar.disabled = true;
      return;
    }
    mapa = L.map(viewport, { zoomControl: false, scrollWheelZoom: false }).setView([vista.latitude, vista.longitude], zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapa);
    mapa.on("click", evento => marcar(evento.latlng));
    if (candidato) marcar({ lat: candidato.latitude, lng: candidato.longitude }, false);
    requestAnimationFrame(() => mapa.invalidateSize());
  } };
}
