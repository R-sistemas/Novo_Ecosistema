import { consultarProntos } from "../dados/pedidos.mjs";
import { tempoDesdePedido } from "../regras/fila.mjs";
import { slugValido } from "../../slug-loja.mjs";

export function iniciarRetirada() {
  const slug = new URLSearchParams(location.search).get("loja");
  const fila = document.getElementById("fila-retirada");
  const status = document.getElementById("status-retirada");
  const repetir = document.getElementById("repetir-retirada");
  const expandir = document.getElementById("expandir-retirada");
  if (!slugValido(slug)) {
    status.textContent = "Abra o link da tela de retirada com o endereço da loja.";
    return;
  }
  document.getElementById("loja-retirada").textContent = slug.split("-").join(" ");
  expandir.hidden = !document.fullscreenEnabled;
  expandir.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* o navegador pode controlar tela cheia */ }
  };
  document.addEventListener("fullscreenchange",() => {
    expandir.textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
  });

  let carregando = false;
  let assinatura;
  function exibir(pedidos) {
    const atual = JSON.stringify(pedidos);
    if (atual !== assinatura) {
      assinatura = atual;
      fila.replaceChildren(...pedidos.map(pedido => {
        const card = document.createElement("li");
        const comanda = document.createElement("h2");
        const mesa = document.createElement("p");
        const tempo = document.createElement("p");
        const itens = document.createElement("p");
        comanda.textContent = "Comanda " + pedido.comanda;
        mesa.textContent = "Mesa " + pedido.mesa;
        tempo.dataset.criadoEm = pedido.criado_em;
        itens.className = "itens-retirada";
        itens.textContent = pedido.itens.map(i => i.quantidade + " × " + i.nome).join(" · ");
        card.append(comanda,mesa,tempo,itens);
        return card;
      }));
    }
    for (const tempo of fila.querySelectorAll("[data-criado-em]")) {
      tempo.textContent = tempoDesdePedido(tempo.dataset.criadoEm) + " desde o pedido";
    }
    status.textContent = pedidos.length ? "" : "Nenhum pedido pronto";
  }
  async function atualizar() {
    if (carregando || document.hidden) return;
    carregando = repetir.disabled = true;
    try {
      const pedidos = await consultarProntos(slug);
      if (!Array.isArray(pedidos)) {
        exibir([]);
        status.textContent = "Estabelecimento indisponível.";
        repetir.hidden = false;
        return;
      }
      exibir(pedidos);
      repetir.hidden = true;
    } catch {
      exibir([]);
      status.textContent = "Não foi possível atualizar os pedidos.";
      repetir.hidden = false;
    } finally {
      carregando = repetir.disabled = false;
    }
  }
  repetir.onclick = atualizar;
  document.addEventListener("visibilitychange",atualizar);
  setInterval(atualizar,12000);
  setInterval(() => {
    if (document.hidden || fila.scrollHeight <= fila.clientHeight || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const chegouAoFim = fila.scrollTop + fila.clientHeight >= fila.scrollHeight - 2;
    fila.scrollTo({top:chegouAoFim ? 0 : fila.scrollTop + fila.clientHeight,behavior:"smooth"});
  },10000);
  void atualizar();
}
