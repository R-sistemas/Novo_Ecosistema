export async function abrirCreditoTeste(dados, aoEnviar, producao = false) {
  const painel = document.getElementById("painel-credito-teste");
  const formulario = document.getElementById("configurar-credito-teste");
  painel.hidden = false;
  formulario.onsubmit = async evento => {
    evento.preventDefault();
    const mensagem = document.getElementById("status-credito-teste");
    mensagem.textContent = "";
    const chave = document.getElementById("chave-credito-teste").value.trim();
    formulario.inert = true;
    try {
      if (!window.MercadoPago) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://sdk.mercadopago.com/js/v2";
          script.onload = resolve;
          script.onerror = reject;
          document.head.append(script);
        });
      }
      const mp = new window.MercadoPago(chave, { locale: "pt-BR" });
      await mp.bricks().create("cardPayment", "formulario-credito-teste", {
        initialization: { amount: dados.totalCentavos / 100 },
        customization: { paymentMethods: { maxInstallments: 1 } },
        callbacks: {
          onReady() { formulario.hidden = true; },
          async onSubmit(cartao) {
            mensagem.textContent = "Verificando pagamento…";
            try {
              const ambiente = producao ? "quiosque" : "teste";
              const resposta = await fetch("/api/checkout-credito-mercado-pago-" + ambiente, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...dados.pedido, cartao: {
                  token: cartao.token, bandeira: cartao.payment_method_id, email: cartao.payer?.email
                } })
              });
              const resultado = await resposta.json();
              if (resposta.status === 402) dados.pedido.p_id = crypto.randomUUID();
              if (!resposta.ok) throw new Error(resultado.erro);
              painel.hidden = true;
              await aoEnviar(dados.pedido.p_id);
            } catch (erro) {
              mensagem.textContent = erro.message;
              mensagem.focus();
              throw erro;
            }
          },
          onError() {
            if (!mensagem.textContent || mensagem.textContent === "Verificando pagamento…") {
              mensagem.textContent = "O formulário de cartão encontrou um erro.";
              mensagem.focus();
            }
          }
        }
      });
    } catch {
      mensagem.textContent = "Confira a Public Key de teste e tente carregar o formulário novamente.";
    } finally {
      formulario.inert = false;
    }
  };
  if (producao) {
    document.getElementById("chave-credito-teste").value = "APP_USR-28b0f004-3565-43de-99f6-51fb3cde8735";
    await formulario.onsubmit(new Event("submit"));
  }
}
