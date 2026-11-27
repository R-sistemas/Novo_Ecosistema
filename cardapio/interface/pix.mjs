import { gerarPix } from "../dados/pagamentos.mjs";
const el = id => document.getElementById(id);

export function configurarPix(ctx) {
  const codigo = el("pix-codigo");
  const copiar = el("copiar-pix");
  const aviso = el("aviso-copiar-pix");
  copiar.onclick = async () => {
    try {
      await navigator.clipboard.writeText(codigo.value);
      aviso.textContent = "Código Pix copiado.";
    } catch {
      codigo.focus();
      codigo.select();
      aviso.textContent = "Copie o código Pix selecionado.";
    }
  };
  async function mostrarPix(dados) {
    const pix = await gerarPix(dados, ctx);
    if (!pix) return;
    const imagem = el("qr-pix");
    imagem.hidden = !pix.imagem;
    if (pix.imagem) imagem.src = "data:image/png;base64," + pix.imagem;
    else imagem.removeAttribute("src");
    el("titulo-pix").textContent = ctx.pixTeste ? "Pix Sandbox" : "Pix";
    codigo.value = pix.copiaECola ?? "";
    copiar.disabled = !codigo.value;
    aviso.textContent = "";
    el("pagamento-pix").hidden = false;
  }

  ctx.mostrarPix = mostrarPix;
}
