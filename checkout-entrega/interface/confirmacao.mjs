import { consultarFrete, registrarEntrega } from "../dados/checkout.mjs";
import { telefoneNacional, trocoInsuficiente } from "../regras/pedido.mjs";
import { configuracaoCartao } from "../../cardapio/regras/cartao.mjs";
const el = id => document.getElementById(id);

export function configurarConfirmacao(ctx) {
  ctx.botao.onclick = async () => {
    if (ctx.estado.ocupado) return;
    ctx.erro.textContent = "";
    if (ctx.estado.etapa === 0) {
      if (!ctx.carrinho.itens().length) return ctx.aviso("Adicione ao menos um produto.");
      if (!telefoneNacional(ctx.estado.telefone)) ctx.marcarCampo("telefone", "Informe um celular válido com DDD.");
      if (ctx.estado.nome.trim().length < 2) ctx.marcarCampo("nome", "Informe seu nome para continuar.");
      if (ctx.estado.nome.trim().length < 2 || !telefoneNacional(ctx.estado.telefone)) return;
      if (!ctx.estado.pino) return ctx.marcarLocalizacao();
      if (!ctx.estado.pino || ctx.estado.cotacaoPino !== ctx.estado.pino.maps_url || ctx.estado.frete === null) {
        if (!await ctx.cotar()) return;
      }
      ctx.estado.etapa = 1; ctx.render(); return;
    }
    if (!ctx.estado.metodo) {
      ctx.conteudo.querySelectorAll(".checkout-grupo-pagamento").forEach(grupo => grupo.classList.add("checkout-pagamento-invalido"));
      ctx.conteudo.querySelector(".checkout-grupo-pagamento")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (trocoInsuficiente(ctx.estado, ctx.subtotal() + ctx.estado.frete)) return ctx.marcarCampo("troco", "O troco deve ser igual ou superior ao total.");
    ctx.estado.ocupado = true;
    ctx.botao.disabled = true;
    el("limpar-carrinho").disabled = true;
    try {
      const chave = ctx.estado.pino.maps_url;
      const cotacaoAnterior = ctx.estado.frete;
      const { ok: cotacaoOk, resultado: novaCotacao } = await consultarFrete(ctx.slug, ctx.enderecoParaCotar());
      if (!cotacaoOk) throw new Error(novaCotacao.erro || "Não foi possível confirmar o frete.");
      if (ctx.estado.pino.maps_url !== chave) throw new Error("A localização mudou. Confira o pedido novamente.");
      if (novaCotacao.frete_centavos !== cotacaoAnterior) return ctx.mostrarFreteAtualizado(novaCotacao.frete_centavos);
      const dados = {
        p_slug: ctx.slug, p_itens: ctx.carrinho.itens(),
        p_cliente: ctx.estado.nome.trim(), endereco: ctx.endereco(), pagamento: ctx.estado.modalidade,
        frete_centavos: ctx.estado.frete
      };
      const cartao = ctx.estado.metodo === "credit" ? configuracaoCartao(ctx.metodosOnline) : null;
      const assinatura = JSON.stringify([dados, cartao]);
      if (ctx.estado.tentativa?.assinatura !== assinatura) ctx.estado.tentativa = { id: crypto.randomUUID(), assinatura };
      dados.p_id = ctx.estado.tentativa.id;
      if (ctx.estado.metodo === "pix") { await ctx.aoPix(dados); ctx.salvarDados(); await ctx.aoConfirmar(dados.p_id, "pix"); }
      else if (ctx.estado.modalidade === "na_entrega") {
        const { ok, status, resultado } = await registrarEntrega(dados);
        if (status === 409 && Number.isSafeInteger(resultado.frete_centavos)) return ctx.mostrarFreteAtualizado(resultado.frete_centavos);
        if (!ok) throw new Error(resultado.erro || "Não foi possível registrar o pedido.");
        ctx.salvarDados();
        await ctx.aoConfirmar(resultado.pedido, "na_entrega");
      } else if (ctx.estado.metodo === "credit") {
        if (!cartao) throw new Error("Cartão indisponível para esta loja.");
        const { abrirCreditoTeste } = await import("../../credito-teste.mjs");
        el("carrinho-cardapio").close();
        el("vitrine").hidden = true;
        el("barra-cardapio").hidden = true;
        await abrirCreditoTeste({
          totalCentavos: ctx.subtotal() + ctx.estado.frete,
          ...cartao,
          aoRecusar: id => { ctx.estado.tentativa.id = id; },
          pedido: { ...dados }, aoFreteAlterado(novoFrete) {
            el("painel-credito-teste").hidden = true;
            ctx.estado.etapa = 1;
            ctx.render();
            el("carrinho-cardapio").showModal();
            ctx.mostrarFreteAtualizado(novoFrete);
          }
        }, id => { ctx.salvarDados(); return ctx.aoConfirmar(id, "credito"); });
      } else throw new Error("Escolha um método de pagamento disponível.");
    } catch (falha) {
      if (Number.isSafeInteger(falha.frete_centavos)) ctx.mostrarFreteAtualizado(falha.frete_centavos);
      else ctx.aviso(falha.message);
    }
    finally { ctx.estado.ocupado = false; ctx.botao.disabled = !ctx.carrinho.itens().length; el("limpar-carrinho").disabled = false; }
  };
}
