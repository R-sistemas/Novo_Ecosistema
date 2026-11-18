const el = id => document.getElementById(id);

export function configurarEventos(ctx) {
  ctx.conteudo.addEventListener("click", evento => {
    const metodo = evento.target.closest("[data-metodo]")?.dataset.metodo;
    if (metodo) {
      ctx.estado.metodo = metodo;
      ctx.estado.modalidade = ["cash", "terminal"].includes(metodo) ? "na_entrega" : "online";
      ctx.render();
    }
    const etapa = evento.target.closest("[data-etapa]")?.dataset.etapa;
    if (etapa) { ctx.estado.etapa = Number(etapa); ctx.render(); }
  });
  ctx.conteudo.addEventListener("input", evento => {
    const { name, value } = evento.target;
    if (name === "nome" || name === "telefone" || name === "troco") {
      evento.target.closest(".checkout-campo")?.classList.remove("checkout-campo-invalido");
      evento.target.removeAttribute("aria-invalid");
      evento.target.closest(".checkout-campo")?.querySelector(".checkout-campo-erro")?.remove();
    }
    if (["logradouro", "numero", "bairro", "cidade", "complemento"].includes(name)) ctx.estado.endereco[name] = value.trim();
    if (name === "nome") ctx.estado.nome = value;
    if (name === "telefone") ctx.estado.telefone = value;
    if (name === "troco") ctx.estado.troco = value;
  });
  ctx.conteudo.addEventListener("change", evento => {
    if (evento.target.name === "lembrar") ctx.estado.lembrar = evento.target.checked;
  });
  ctx.voltar.onclick = () => { ctx.erro.textContent = ""; ctx.estado.etapa = Math.max(0, ctx.estado.etapa - 1); ctx.render(); };
  el("pedido").hidden = false;
  el("vitrine").hidden = false;
  el("barra-cardapio").hidden = false;
  document.addEventListener("cardapio:carrinho-aberto", () => {
    ctx.render();
    if (ctx.estado.pino && ctx.estado.frete === null) ctx.agendarCotacao();
  });
  document.addEventListener("cardapio:carrinho-limpo", () => {
    ctx.invalidarCotacao();
    ctx.picker.limpar();
    ctx.reiniciarEstado();
    ctx.erro.textContent = "";
    ctx.conteudo.replaceChildren();
  });
  new MutationObserver(() => { if (ctx.estado.etapa === 0 && el("carrinho-cardapio").open) ctx.render(); }).observe(ctx.itens, { childList: true, subtree: true, characterData: true });
}
