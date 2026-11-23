import { enviarPedido, registrarEntrega } from "../dados/pedidos.mjs";
const el = id => document.getElementById(id);

export function configurarEnvio(ctx) {
  function fecharCompra() {
    el("carrinho-cardapio").close();
    el("vitrine").hidden = true;
    el("barra-cardapio").hidden = true;
    window.scrollTo(0, 0);
  }
  el("pedido").addEventListener("click", evento => {
    if (!evento.target.closest("[data-pagamento], [data-recebimento]")) return;
    el("passo-pedido").textContent = "Próximo passo · Confirme seu pedido";
    el("enviar-pedido").classList.add("guiado");
  });
  el("pedido").onsubmit = evento => {
    evento.preventDefault();
    ctx.prepararSomMesa();
    ctx.executarComFeedback(async () => {
      el("erro-pedido").textContent = "";
      const p_itens = ctx.carrinho.itens();
      if (!p_itens.length) throw new Error("Escolha pelo menos um produto.");
      const p_cliente = el("cliente").value.trim();
      if (ctx.creditoTeste || ctx.creditoQuiosque || ctx.formaPagamento === "credito-mp") {
        if (!ctx.creditoTeste) {
          el("titulo-credito").textContent = "Cartão de crédito";
          el("aviso-credito").textContent = ctx.opcoesMP ? "Pagamento Mercado Pago" : "Piloto do Quiosque";
        }
        const totalCentavos = ctx.carrinho.total();
        const { abrirCreditoTeste } = await import("../../credito-teste.mjs");
        await abrirCreditoTeste({
          totalCentavos, chavePublica: ctx.opcoesMP?.chave_publica, pedido: { p_slug: ctx.p_slug, p_mesa: ctx.p_mesa, p_itens, p_cliente, p_id: crypto.randomUUID() }
        }, async id => {
          ctx.p_id = id;
          ctx.confirmarPedidoMesa();
          ctx.parametros.set("pedido", id);
          if (!ctx.creditoTeste) { ctx.creditoQuiosque = true; ctx.parametros.set("cartao", "credito"); }
          history.replaceState(null, "", "?" + ctx.parametros);
          el("acompanhar").hidden = false;
          await ctx.acompanhar();
        }, !ctx.creditoTeste);
        el("pedido").hidden = true;
        fecharCompra();
        return;
      }
      const pagamento = ctx.entrega ? ctx.formaPagamento : undefined;
      const endereco = ctx.entrega ? ctx.enderecoEntrega() : undefined;
      let frete_centavos;
      if (ctx.entrega) {
        const chave = ctx.chaveEndereco(endereco);
        if (ctx.cotacao.enderecoCotado !== chave || ctx.cotacao.freteEntregaCentavos === null) {
          const valorAtualizado = await ctx.cotarFrete(endereco);
          if (valorAtualizado === null) throw new Error("O endereço mudou durante o cálculo. Aguarde a cotação atualizada.");
          throw new Error("Frete calculado. Confira o valor acima e confirme o pedido novamente.");
        }
        frete_centavos = ctx.cotacao.freteEntregaCentavos;
      }
      const pix = ctx.entrega ? pagamento === "online" : ctx.pixDisponivel && ctx.formaPagamento === "pix";
      const cpfCnpj = pix && !ctx.pixTeste ? el("documento-pix").value : undefined;
      const assinatura = JSON.stringify({ p_itens, p_cliente, pix, cpfCnpj, endereco, pagamento, frete_centavos });
      if (ctx.tentativa?.assinatura !== assinatura) ctx.tentativa = { assinatura, id: crypto.randomUUID() };
      el("pedido").inert = true;
      try {
        const dados = { p_slug: ctx.p_slug, p_mesa: ctx.p_mesa, p_itens, p_cliente, p_id: ctx.tentativa.id };
        if (ctx.entrega) ctx.parametros.set("entrega", ctx.entregaTeste ? "teste" : "sim");
        else if (!ctx.entregaTeste && !ctx.entregaQuiosque) ctx.parametros.delete("entrega");
        if (pix) {
          await ctx.mostrarPix({ ...dados, cpfCnpj, endereco, pagamento, frete_centavos });
          if (ctx.pixMercadoPagoQuiosque) ctx.parametros.set("pix", "mercado-pago");
          el("documento-pix").value = "";
          ctx.p_id = ctx.tentativa.id;
        } else if (ctx.entrega) {
          const { status, ok, resultado } = await registrarEntrega(dados, { endereco, pagamento, frete_centavos }, ctx.entregaTeste);
          if (status === 409 && Number.isSafeInteger(resultado.frete_centavos)) {
            ctx.cotacao.freteEntregaCentavos = resultado.frete_centavos;
            ctx.cotacao.enderecoCotado = ctx.chaveEndereco(endereco);
            ctx.atualizarTextoFrete();
          }
          if (!ok) throw new Error(resultado.erro);
          ctx.p_id = resultado.pedido;
        } else {
          ctx.p_id = await enviarPedido(dados);
        }
        ctx.confirmarPedidoMesa();
        ctx.parametros.set("pedido", ctx.p_id);
        ctx.parametros.delete("mesa");
        history.replaceState(null, "", "?" + ctx.parametros);
        el("pedido").hidden = true;
        fecharCompra();
        el("acompanhar").hidden = false;
        await ctx.acompanhar();
      } finally {
        el("pedido").inert = false;
      }
    });
  };
}
