import { el } from "../../pdv/interface/elementos.mjs";

export function configurarEventos(ctx) {
  ctx.loja.onchange = ctx.dia.onchange = ctx.mudarFiltro;
  el("atualizar-monitor").onclick = ctx.solicitarAtualizacao;
  const botoesAbas = [...document.querySelectorAll("[data-aba]")];
  for (const botao of botoesAbas) {
    botao.onclick = () => {
      ctx.estado.aba = botao.dataset.aba;
      for (const item of botoesAbas) item.setAttribute("aria-pressed", String(item === botao));
      ctx.renderizarLista();
    };
  }
  function aoVisivel() {
    if (!document.hidden) ctx.solicitarAtualizacao();
  }
  document.addEventListener("visibilitychange", aoVisivel);
  window.addEventListener("online", aoVisivel);
  setInterval(aoVisivel, 20000);
}
