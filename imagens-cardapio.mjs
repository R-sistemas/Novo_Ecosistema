export async function otimizarImagem(arquivo, { lado = 640, limite = 60000, quadrada = true } = {}) {
  if (!["image/png","image/jpeg","image/webp"].includes(arquivo.type) || arquivo.size > 8 * 1024 * 1024) {
    throw new Error("Escolha uma imagem PNG, JPEG ou WebP de até 8 MB.");
  }
  const imagem = await createImageBitmap(arquivo);
  try {
    const canvas = document.createElement("canvas");
    const corte = Math.min(imagem.width, imagem.height);
    const largura = quadrada ? corte : imagem.width;
    const altura = quadrada ? corte : imagem.height;
    const escala = Math.min(1, lado / Math.max(largura, altura));
    canvas.width = Math.max(1, Math.round(largura * escala));
    canvas.height = Math.max(1, Math.round(altura * escala));
    canvas.getContext("2d").drawImage(imagem, (imagem.width - largura) / 2,
      (imagem.height - altura) / 2, largura, altura, 0, 0, canvas.width, canvas.height);
    for (const qualidade of [.82,.7,.58,.45,.32,.2]) {
      const dados = canvas.toDataURL("image/webp", qualidade);
      if (dados.startsWith("data:image/webp;base64,") && (dados.length - 23) * .75 <= limite) return dados;
    }
    throw new Error("Não foi possível reduzir a imagem. Escolha uma imagem mais simples.");
  } finally {
    imagem.close();
  }
}
