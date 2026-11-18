export async function gerarPix(dados, opcoes) {
  const { pixMercadoPagoTeste, pixMercadoPagoQuiosque, pixTeste } = opcoes;
  const rota = pixMercadoPagoTeste ? "/api/checkout-pix-mercado-pago-teste"
    : pixMercadoPagoQuiosque ? "/api/checkout-pix-mercado-pago-quiosque"
      : pixTeste ? "/api/checkout-pix-sandbox" : "/api/checkout-pix-quiosque";
  const resposta = await fetch(rota, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados)
  });
  const pix = await resposta.json();
  if (resposta.ok && pix.aguardaConfirmacao) return null;
  if (!resposta.ok || !pix.imagem || !pix.copiaECola) {
    const erro = new Error(pix.erro ?? "QR Code indisponível.");
    if (resposta.status === 409 && Number.isSafeInteger(pix.frete_centavos)) erro.frete_centavos = pix.frete_centavos;
    throw erro;
  }
  return pix;
}
