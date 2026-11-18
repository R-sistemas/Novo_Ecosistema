import { consultarFrete } from "../dados/checkout.mjs";

export function configurarCotacao(ctx) {
  let cotacaoTimer = null, cotacaoAbort = null, cotacaoVersao = 0;
  function invalidarCotacao() {
    cotacaoVersao++;
    clearTimeout(cotacaoTimer);
    cotacaoTimer = null;
    cotacaoAbort?.abort();
    cotacaoAbort = null;
    ctx.estado.frete = null;
    ctx.estado.cotacaoPino = null;
    ctx.estado.ocupado = false;
    ctx.erro.textContent = "";
    ctx.botao.disabled = !ctx.carrinho.itens().length;
  }
  function agendarCotacao() {
    if (!ctx.estado.pino || !ctx.carrinho.itens().length) return;
    cotacaoTimer = setTimeout(() => { cotacaoTimer = null; void ctx.cotar(); }, 450);
  }
  async function cotar() {
    if (!ctx.estado.pino) { ctx.aviso("Marque o local da entrega no mapa para calcular o frete."); return false; }
    clearTimeout(cotacaoTimer);
    cotacaoTimer = null;
    cotacaoAbort?.abort();
    cotacaoAbort = new AbortController();
    const sinal = cotacaoAbort.signal;
    const versao = ++cotacaoVersao;
    const chave = ctx.estado.pino.maps_url;
    ctx.estado.ocupado = true;
    ctx.erro.textContent = "";
    ctx.botao.disabled = true;
    ctx.botao.textContent = "Calculando entrega…";
    try {
      const { ok, resultado } = await consultarFrete(ctx.slug, ctx.enderecoParaCotar(), sinal);
      if (versao !== cotacaoVersao || ctx.estado.pino?.maps_url !== chave) return false;
      if (!ok || !Number.isSafeInteger(resultado.frete_centavos)) {
        ctx.estado.frete = null;
        ctx.estado.cotacaoPino = null;
        ctx.atualizarResumo();
        ctx.aviso(resultado.erro || "Não foi possível calcular a entrega para este local.");
        return false;
      }
      ctx.estado.frete = resultado.frete_centavos;
      ctx.estado.cotacaoPino = chave;
      ctx.atualizarResumo();
      return true;
    } catch {
      if (versao !== cotacaoVersao || sinal.aborted) return false;
      ctx.aviso("Não foi possível calcular o frete agora. Tente novamente.");
      return false;
    } finally {
      if (versao === cotacaoVersao) {
        ctx.estado.ocupado = false;
        cotacaoAbort = null;
        ctx.botao.disabled = !ctx.carrinho.itens().length;
        ctx.botao.textContent = ctx.estado.etapa === 0 ? "Continuar para pagamento" : "Confirmar pedido";
      }
    }
  }
  Object.assign(ctx, { invalidarCotacao, agendarCotacao, cotar });
}
