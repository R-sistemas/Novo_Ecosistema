const TILE = 256;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const link = p => `https://www.google.com/maps?q=${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

function world(lat, lng, zoom) {
  const scale = TILE * 2 ** zoom;
  const rad = clamp(lat, -85.0511, 85.0511) * Math.PI / 180;
  return { x: (lng + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * scale };
}
function geo(x, y, zoom) {
  const scale = TILE * 2 ** zoom;
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI,
    longitude: x / scale * 360 - 180 };
}

export function criarLocationPicker({ centro, aoConfirmar }) {
  const painel = document.createElement("section");
  painel.className = "checkout-mapa-inline";
  painel.innerHTML = `<div class="checkout-mapa-cabecalho"><strong>Localização no mapa <small>OBRIGATÓRIO</small></strong><p>Toque no local da entrega. Arraste para mover e use dois dedos para ampliar.</p></div>
    <div class="checkout-mapa-acoes"><button type="button" data-acao="gps">◎ Usar minha localização</button><button type="button" data-acao="mais" aria-label="Ampliar mapa">+</button><button type="button" data-acao="menos" aria-label="Reduzir mapa">−</button></div>
    <div class="checkout-mapa-viewport" tabindex="0" role="application" aria-label="Mapa: toque para marcar, arraste para mover, use dois dedos para ampliar; teclado: setas para mover, Enter para marcar"><div class="checkout-mapa-tiles"></div><div class="checkout-mapa-pino" hidden aria-hidden="true">●</div><div class="checkout-mapa-instrucao">Toque no ponto exato da entrega</div><a class="checkout-mapa-credito" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></div>
    <p class="checkout-mapa-feedback" role="status">Nenhum ponto confirmado.</p><button type="button" class="checkout-mapa-confirmar" data-acao="confirmar" disabled>Confirmar este ponto ✓</button>`;
  const viewport = painel.querySelector(".checkout-mapa-viewport");
  const tiles = painel.querySelector(".checkout-mapa-tiles");
  const marker = painel.querySelector(".checkout-mapa-pino");
  const feedback = painel.querySelector(".checkout-mapa-feedback");
  const confirmar = painel.querySelector('[data-acao="confirmar"]');
  const view = { latitude: centro.latitude, longitude: centro.longitude, zoom: 15 };
  const pointers = new Map();
  const imagens = new Map();
  let candidato = null, confirmado = null, arrastou = false;
  let distanciaAnterior = 0, centroAnterior = null, gpsWatch = null, gpsTimer = null;

  function desenharPino() {
    marker.hidden = !candidato;
    if (!candidato) return;
    const c = world(view.latitude, view.longitude, view.zoom);
    const p = world(candidato.latitude, candidato.longitude, view.zoom);
    marker.style.left = `${viewport.clientWidth / 2 + p.x - c.x}px`;
    marker.style.top = `${viewport.clientHeight / 2 + p.y - c.y}px`;
  }
  function desenharMapa() {
    if (!viewport.clientWidth) return;
    const c = world(view.latitude, view.longitude, view.zoom);
    const minX = Math.floor((c.x - viewport.clientWidth / 2) / TILE);
    const maxX = Math.floor((c.x + viewport.clientWidth / 2) / TILE);
    const minY = Math.floor((c.y - viewport.clientHeight / 2) / TILE);
    const maxY = Math.floor((c.y + viewport.clientHeight / 2) / TILE);
    const quantidade = 2 ** view.zoom, visiveis = new Set();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      if (y < 0 || y >= quantidade) continue;
      const chave = `${view.zoom}/${x}/${y}`;
      visiveis.add(chave);
      let imagem = imagens.get(chave);
      if (!imagem) {
        imagem = document.createElement("img");
        imagem.alt = "";
        imagem.draggable = false;
        imagem.src = `https://tile.openstreetmap.org/${view.zoom}/${((x % quantidade) + quantidade) % quantidade}/${y}.png`;
        imagens.set(chave, imagem);
        tiles.append(imagem);
      }
      imagem.style.left = `${x * TILE - (c.x - viewport.clientWidth / 2)}px`;
      imagem.style.top = `${y * TILE - (c.y - viewport.clientHeight / 2)}px`;
    }
    for (const [chave, imagem] of imagens) if (!visiveis.has(chave)) {
      imagem.remove();
      imagens.delete(chave);
    }
    desenharPino();
  }
  function mover(dx, dy) {
    const c = world(view.latitude, view.longitude, view.zoom);
    const p = geo(c.x + dx, c.y + dy, view.zoom);
    view.latitude = clamp(p.latitude, -85.05, 85.05);
    view.longitude = clamp(p.longitude, -180, 180);
    desenharMapa();
  }
  function marcar(x, y) {
    const c = world(view.latitude, view.longitude, view.zoom);
    const p = geo(c.x + x - viewport.clientWidth / 2, c.y + y - viewport.clientHeight / 2, view.zoom);
    candidato = { latitude: Number(p.latitude.toFixed(6)), longitude: Number(p.longitude.toFixed(6)) };
    confirmar.disabled = false;
    confirmar.textContent = "Confirmar este ponto ✓";
    feedback.textContent = `Ponto selecionado: ${candidato.latitude.toFixed(6)}, ${candidato.longitude.toFixed(6)}. Confirme para calcular a entrega.`;
    desenharPino();
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
      view.latitude = latitude;
      view.longitude = longitude;
      view.zoom = accuracy <= 30 ? 18 : 17;
      desenharMapa();
      marcar(viewport.clientWidth / 2, viewport.clientHeight / 2);
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
      confirmado = { ...candidato, maps_url: link(candidato) };
      confirmar.textContent = "Ponto confirmado ✓";
      feedback.textContent = "Localização confirmada. Você pode ajustar o pino e confirmar novamente.";
      aoConfirmar(confirmado);
    }
    if (acao === "mais" || acao === "menos") {
      view.zoom = clamp(view.zoom + (acao === "mais" ? 1 : -1), 4, 19);
      desenharMapa();
    }
  });
  viewport.addEventListener("pointerdown", evento => {
    if (evento.target.closest("a,button")) return;
    pointers.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    arrastou = false;
    viewport.setPointerCapture(evento.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      distanciaAnterior = Math.hypot(a.x - b.x, a.y - b.y);
      centroAnterior = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  });
  viewport.addEventListener("pointermove", evento => {
    const anterior = pointers.get(evento.pointerId);
    if (!anterior) return;
    pointers.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    if (pointers.size === 2) {
      arrastou = true;
      const [a, b] = [...pointers.values()];
      const distancia = Math.hypot(a.x - b.x, a.y - b.y);
      const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (centroAnterior) mover(centroAnterior.x - meio.x, centroAnterior.y - meio.y);
      if (distanciaAnterior && (distancia > distanciaAnterior * 1.2 || distancia < distanciaAnterior / 1.2)) {
        view.zoom = clamp(view.zoom + (distancia > distanciaAnterior ? 1 : -1), 4, 19);
        distanciaAnterior = distancia;
        desenharMapa();
      }
      centroAnterior = meio;
      return;
    }
    const dx = evento.clientX - anterior.x, dy = evento.clientY - anterior.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) arrastou = true;
    if (arrastou) mover(-dx, -dy);
  });
  function liberar(evento) {
    const ponto = pointers.get(evento.pointerId);
    if (ponto && pointers.size === 1 && !arrastou && evento.type === "pointerup") {
      const area = viewport.getBoundingClientRect();
      marcar(evento.clientX - area.left, evento.clientY - area.top);
    }
    pointers.delete(evento.pointerId);
    if (pointers.size < 2) { distanciaAnterior = 0; centroAnterior = null; }
  }
  viewport.addEventListener("pointerup", liberar);
  viewport.addEventListener("pointercancel", liberar);
  viewport.addEventListener("wheel", evento => {
    evento.preventDefault();
    view.zoom = clamp(view.zoom + (evento.deltaY < 0 ? 1 : -1), 4, 19);
    desenharMapa();
  }, { passive: false });
  viewport.addEventListener("keydown", evento => {
    const deltas = { ArrowUp: [0, -50], ArrowDown: [0, 50], ArrowLeft: [-50, 0], ArrowRight: [50, 0] };
    if (deltas[evento.key]) { evento.preventDefault(); mover(...deltas[evento.key]); }
    if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); marcar(viewport.clientWidth / 2, viewport.clientHeight / 2); }
  });
  return { montar(container) {
    container.append(painel);
    if (confirmado && !candidato) candidato = { latitude: confirmado.latitude, longitude: confirmado.longitude };
    confirmar.disabled = !candidato;
    desenharMapa();
  } };
}
