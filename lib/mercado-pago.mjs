const api = "https://api.mercadopago.com/v1/orders";

export function pixMercadoPagoRecebido(ordem, { pedidoId, totalCentavos }) {
  return pagamentoMercadoPagoRecebido(ordem, { pedidoId, totalCentavos }, "bank_transfer") &&
    ordem.transactions.payments[0].payment_method.id === "pix";
}

export function pagamentoMercadoPagoRecebido(ordem, { pedidoId, totalCentavos }, tipo) {
  const pagamentos = ordem?.transactions?.payments;
  if (!Array.isArray(pagamentos) || pagamentos.length !== 1) return false;
  const [pagamento] = pagamentos;
  const valor = (totalCentavos / 100).toFixed(2);
  return ordem.external_reference === pedidoId &&
    ordem.total_amount === valor && pagamento.amount === valor &&
    ordem.status === "processed" && ordem.status_detail === "accredited" &&
    pagamento.status === "processed" &&
    pagamento.payment_method?.type === tipo;
}

export function mercadoPago(accessToken) {
  if (!accessToken) throw new Error("Access Token do Mercado Pago ausente.");

  async function solicitar(url, opcoes = {}) {
    const resposta = await fetch(url, {
      ...opcoes,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + accessToken,
        ...opcoes.headers
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => null);
      const codigos = [dados?.code, dados?.error, ...(Array.isArray(dados?.errors)
        ? dados.errors.map(erro => erro?.code)
        : [])].filter(codigo => typeof codigo === "string" && /^[a-z][a-z_]{1,63}$/i.test(codigo));
      const detalhe = codigos.length ? " (" + [...new Set(codigos)].join(", ") + ")" : "";
      throw Object.assign(new Error("Mercado Pago retornou HTTP " + resposta.status + detalhe), { status: resposta.status, codigos });
    }
    return resposta.json();
  }

  function criarOrdem({ pedidoId, totalCentavos, pagador, metodo, expiraEm }) {
      if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) {
        throw new Error("Valor inválido para pagamento.");
      }
      const valor = (totalCentavos / 100).toFixed(2);
      return solicitar(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": pedidoId },
        body: JSON.stringify({
          type: "online",
          processing_mode: "automatic",
          external_reference: pedidoId,
          total_amount: valor,
          payer: pagador,
          transactions: {
            payments: [{ amount: valor, payment_method: metodo, ...(expiraEm ? { expiration_time: expiraEm } : {}) }]
          }
        })
      });
  }

  return {
    criarPix({ pedidoId, totalCentavos, email, pagadorTeste, expiraEm }) {
      return criarOrdem({ pedidoId, totalCentavos, pagador: { email, ...pagadorTeste },
        metodo: { id: "pix", type: "bank_transfer" }, expiraEm });
    },
    criarCartao: criarOrdem,
    consultarOrdem(ordemId) {
      return solicitar(api + "/" + encodeURIComponent(ordemId));
    },
    cancelarOrdem(ordemId, chave) {
      return solicitar(api + "/" + encodeURIComponent(ordemId) + "/cancel", {
        method: "POST", headers: { "X-Idempotency-Key": chave }
      });
    }
  };
}
