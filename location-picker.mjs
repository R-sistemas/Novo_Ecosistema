const TILE = 256;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const link = ({ latitude, longitude }) =>
  `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;

function world(latitude, longitude, zoom) {
  const scale = TILE * 2 ** zoom;
  const rad = clamp(latitude, -85.0511, 85.0511) * Math.PI / 180;
  return { x: (longitude + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * scale };
}
function geo(x, y, zoom) {
  const scale = TILE * 2 ** zoom;
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI,
    longitude: x / scale * 360 - 180 };
}

export function criarLocationPicker({ centro, aoConfirmar }) {
  const dialogo = document.createElement("dialog");
  dialogo.className = "checkout-mapa-modal";
  dialogo.innerHTML = `<div class="checkout-mapa-cabecalho"><div><small>R Sistemas × REMO</small><h2>Marque o local da entrega</h2><p>Toque ou clique no mapa para posicionar o pino com precisão.</p></div><button type="button" data-acao="fechar" aria-label="Fechar mapa">×</button></div>
    <div class="checkout-mapa-acoes"><button type="button" data-acao="gps">◎ Usar minha localização</button><button type="button" data-acao="mais">+</button><button type="button" data-acao="menos">−</button></div>
    <div class="checkout-mapa-viewport" tabindex="0" role="application" aria-label="Mapa interativo: clique ou toque para escolher o ponto; use as setas para mover o mapa e Enter para marcar o centro"><div class="checkout-mapa-tiles"></div><div class="checkout-mapa-pino" hidden aria-hidden="true">●</div><div class="checkout-mapa-instrucao">Toque no endereço exato da entrega</div><a class="checkout-mapa-credito" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></div>
    <p class="checkout-mapa-feedback" role="status">Nenhum ponto selecionado.</p><div class="checkout-mapa-rodape"><button type="button" data-acao="fechar">Cancelar</button><button type="button" data-acao="confirmar" disabled>Confirmar localização ✓</button></div>`;
  document.body.append(dialogo);
  const viewport = dialogo.querySelector(".checkout-mapa-viewport");
  const tiles = dialogo.querySelector(".checkout-mapa-tiles");
  const marker = dialogo.querySelector(".checkout-mapa-pino");
  const feedback = dialogo.querySelector(".checkout-mapa-feedback");
  const confirmar = dialogo.querySelector('[data-acao="confirmar"]');
  let view = { latitude: centro.latitude, longitude: centro.longitude, zoom: 15 };
  let candidato = null;
  let confirmado = null;
  let arrasto = null;
  let arrastou = false;
  const pinAt = (x, y) => {
    const centroWorld = world(view.latitude, view.longitude, view.zoom);
    const ponto = geo(centroWorld.x + x - viewport.clientWidth / 2,
      centroWorld.y + y - viewport.clientHeight / 2, view.zoom);
    candidato = { latitude: Number(clamp(ponto.latitude, -90, 90).toFixed(6)),
      longitude: Number(clamp(ponto.longitude, -180, 180).toFixed(6)) };
    feedback.textContent = `Pino selecionado: ${candidato.latitude.toFixed(6)}, ${candidato.longitude.toFixed(6)}. Confirme para usar este ponto.`;
    confirmar.disabled = false;
    desenharPino();
  };
  function desenharPino() {
    marker.hidden = !candidato;
    if (!candidato) return;
    const c = world(view.latitude, view.longitude, view.zoom);
    const p = world(candidato.latitude, candidato.longitude, view.zoom);
    marker.style.left = `${viewport.clientWidth / 2 + p.x - c.x}px`;
    marker.style.top = `${viewport.clientHeight / 2 + p.y - c.y}px`;
  }
  function desenharMapa() {
    const c = world(view.latitude, view.longitude, view.zoom);
    const minX = Math.floor((c.x - viewport.clientWidth / 2) / TILE);
    const maxX = Math.floor((c.x + viewport.clientWidth / 2) / TILE);
    const minY = Math.floor((c.y - viewport.clientHeight / 2) / TILE);
    const maxY = Math.floor((c.y + viewport.clientHeight / 2) / TILE);
    const quantidade = 2 ** view.zoom;
    tiles.replaceChildren();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      if (y < 0 || y >= quantidade) continue;
      const imagem = document.createElement("img");
      imagem.alt = "";
      imagem.draggable = false;
      imagem.loading = "lazy";
      imagem.src = `https://tile.openstreetmap.org/${view.zoom}/${((x % quantidade) + quantidade) % quantidade}/${y}.png`;
      imagem.style.left = `${x * TILE - (c.x - viewport.clientWidth / 2)}px`;
      imagem.style.top = `${y * TILE - (c.y - viewport.clientHeight / 2)}px`;
      tiles.append(imagem);
    }
    desenharPino();
  }
  const mover = (dx, dy) => {
    const c = world(view.latitude, view.longitude, view.zoom);
    const p = geo(c.x + dx, c.y + dy, view.zoom);
    view.latitude = clamp(p.latitude, -85.05, 85.05);
    view.longitude = clamp(p.longitude, -180, 180);
    desenharMapa();
  };
  dialogo.addEventListener("click", evento => {
    const acao = evento.target.closest("[data-acao]")?.dataset.acao;
    if (acao === "fechar") dialogo.close();
    if (acao === "confirmar" && candidato) {
      confirmado = { ...candidato, maps_url: link(candidato) };
      aoConfirmar(confirmado);
      dialogo.close();
    }
    if (acao === "mais" || acao === "menos") {
      view.zoom = clamp(view.zoom + (acao === "mais" ? 1 : -1), 4, 19);
      desenharMapa();
    }
    if (acao === "gps") {
      if (!navigator.geolocation) { feedback.textContent = "Localização indisponível neste aparelho. Marque o pino no mapa."; return; }
      navigator.geolocation.getCurrentPosition(posicao => {
        view.latitude = posicao.coords.latitude;
        view.longitude = posicao.coords.longitude;
        desenharMapa();
        pinAt(viewport.clientWidth / 2, viewport.clientHeight / 2);
      }, () => { feedback.textContent = "Sem acesso ao GPS. Você pode marcar o pino manualmente no mapa."; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }
  });
  viewport.addEventListener("pointerdown", evento => {
    if (evento.target.closest("a,button")) return;
    arrasto = { x: evento.clientX, y: evento.clientY };
    arrastou = false;
    viewport.setPointerCapture(evento.pointerId);
  });
  viewport.addEventListener("pointermove", evento => {
    if (!arrasto) return;
    const dx = evento.clientX - arrasto.x, dy = evento.clientY - arrasto.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) arrastou = true;
    if (arrastou) { mover(-dx, -dy); arrasto = { x: evento.clientX, y: evento.clientY }; }
  });
  viewport.addEventListener("pointerup", evento => {
    if (arrasto && !arrastou) {
      const area = viewport.getBoundingClientRect();
      pinAt(evento.clientX - area.left, evento.clientY - area.top);
    }
    arrasto = null;
  });
  viewport.addEventListener("keydown", evento => {
    const deltas = { ArrowUp: [0, -50], ArrowDown: [0, 50], ArrowLeft: [-50, 0], ArrowRight: [50, 0] };
    if (deltas[evento.key]) { evento.preventDefault(); mover(...deltas[evento.key]); }
    if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); pinAt(viewport.clientWidth / 2, viewport.clientHeight / 2); }
  });
  return { abrir() {
    candidato = confirmado ? { latitude: confirmado.latitude, longitude: confirmado.longitude } : null;
    confirmar.disabled = !candidato;
    if (candidato) { view.latitude = candidato.latitude; view.longitude = candidato.longitude; }
    feedback.textContent = candidato ? `Pino salvo: ${candidato.latitude.toFixed(6)}, ${candidato.longitude.toFixed(6)}` : "Nenhum ponto selecionado. Toque no mapa para marcar.";
    dialogo.showModal();
    desenharMapa();
  } };
}
