export async function abrirCreditoTeste(dados, aoEnviar) {
  let configuracaoDesatualizada = false;
  const sandbox = dados.ambiente === "sandbox";
  const painel = document.getElementById("painel-credito-teste");
  const formulario = document.getElementById("configurar-credito-teste");
  document.getElementById("titulo-credito").textContent = sandbox ? "Crédito de homologação" : "Cartão de crédito";
  document.getElementById("aviso-credito").textContent = sandbox
    ? "Use somente cartões de teste do Mercado Pago." : "Pagamento Mercado Pago";
  painel.hidden = false;
  formulario.onsubmit = async evento => {
    evento.preventDefault();
    const mensagem = document.getElementById("status-credito-teste");
    mensagem.textContent = "";
    const chave = dados.chavePublica;
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
            if (configuracaoDesatualizada) throw new Error("Atualize a página antes de pagar.");
            mensagem.textContent = "Verificando pagamento…";
            try {
              const ambiente = sandbox ? "teste" : "quiosque";
              const resposta = await fetch("/api/checkout-credito-mercado-pago-" + ambiente, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...dados.pedido, chave_publica: chave, cartao: {
                  token: cartao.token, bandeira: cartao.payment_method_id, email: cartao.payer?.email
                } })
              });
              const resultado = await resposta.json();
              if (resposta.status === 409 && Number.isSafeInteger(resultado.frete_centavos) && dados.aoFreteAlterado) {
                dados.aoFreteAlterado(resultado.frete_centavos);
                return;
              }
              if (resposta.status === 409 && resultado.codigo === "configuracao_cartao_alterada") {
                configuracaoDesatualizada = true;
              }
              if (resposta.status === 402) {
                dados.pedido.p_id = crypto.randomUUID();
                dados.aoRecusar?.(dados.pedido.p_id);
              }
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
      mensagem.textContent = "Não foi possível carregar o formulário de cartão. Tente novamente.";
    } finally {
      formulario.inert = false;
    }
  };
  formulario.hidden = false;
  await formulario.onsubmit(new Event("submit"));
}
