import { gerarPix } from "../dados/pagamentos.mjs";
const el = id => document.getElementById(id);

export function configurarPix(ctx) {
  async function mostrarPix(dados) {
    const pix = await gerarPix(dados, ctx);
    if (!pix) return;
    const imagem = el("qr-pix");
    imagem.hidden = !pix.imagem;
    if (pix.imagem) imagem.src = "data:image/png;base64," + pix.imagem;
    else imagem.removeAttribute("src");
    el("titulo-pix").textContent = ctx.pixTeste ? "Pix Sandbox" : "Pix";
    el("pix-codigo").value = pix.copiaECola;
    el("pagamento-pix").hidden = false;
  }

  ctx.mostrarPix = mostrarPix;
}
