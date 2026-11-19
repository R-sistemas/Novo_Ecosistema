import { gerarPix } from "../dados/pagamentos.mjs";
const el = id => document.getElementById(id);

export function configurarPix(ctx) {
  async function mostrarPix(dados) {
    const pix = await gerarPix(dados, ctx);
    if (!pix) return;
    el("qr-pix").src = "data:image/png;base64," + pix.imagem;
    el("titulo-pix").textContent = ctx.pixTeste ? "Pix Sandbox" : "Pix";
    el("pix-codigo").value = pix.copiaECola;
    el("pagamento-pix").hidden = false;
  }

  ctx.mostrarPix = mostrarPix;
}
