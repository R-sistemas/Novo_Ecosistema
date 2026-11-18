import { paraReais } from "../../pdv/regras/moeda.mjs";
import { consultarFrete } from "../dados/pedidos.mjs";
const el = id => document.getElementById(id);

export function configurarFrete(ctx) {
  const enderecoEntrega = () => Object.fromEntries(
    [...el("entrega-teste").querySelectorAll("input")].map(campo => [campo.name, campo.value.trim()])
  );
  const chaveEndereco = endereco => JSON.stringify(endereco);
  const atualizarTextoFrete = () => {
    const aviso = el("frete-cotacao");
    if (!aviso || ctx.cotacao.freteEntregaCentavos === null) return;
    aviso.textContent = `Entrega ${ctx.moeda.format(paraReais(ctx.cotacao.freteEntregaCentavos))} · Total com entrega ${ctx.moeda.format(paraReais(ctx.carrinho.total() + ctx.cotacao.freteEntregaCentavos))}`;
  };
  async function cotarFrete(endereco) {
    const chave = ctx.chaveEndereco(endereco);
    const sequencia = ++ctx.cotacao.sequenciaCotacao;
    const aviso = el("frete-cotacao");
    aviso.textContent = "Calculando a entrega…";
    ctx.cotacao.freteEntregaCentavos = null;
    ctx.cotacao.enderecoCotado = null;
    const { ok, resultado } = await consultarFrete({ p_slug: ctx.p_slug, endereco });
    if (sequencia !== ctx.cotacao.sequenciaCotacao || chave !== ctx.chaveEndereco(ctx.enderecoEntrega())) return null;
    if (!ok || !Number.isSafeInteger(resultado.frete_centavos) || resultado.frete_centavos < 0) {
      aviso.textContent = resultado.erro || "Não foi possível calcular a entrega para este endereço.";
      throw new Error(resultado.erro || "Não foi possível calcular o frete.");
    }
    ctx.cotacao.freteEntregaCentavos = resultado.frete_centavos;
    ctx.cotacao.enderecoCotado = chave;
    ctx.atualizarTextoFrete();
    return ctx.cotacao.freteEntregaCentavos;
  }
  function agendarCotacaoFrete() {
    clearTimeout(ctx.cotacao.temporizadorCotacao);
    ctx.cotacao.sequenciaCotacao++;
    ctx.cotacao.freteEntregaCentavos = null;
    ctx.cotacao.enderecoCotado = null;
    const endereco = ctx.enderecoEntrega();
    if (!["logradouro", "numero", "bairro", "cidade"].every(campo => endereco[campo])) {
      ctx.cotacao.freteEntregaCentavos = null;
      ctx.cotacao.enderecoCotado = null;
      el("frete-cotacao").textContent = "Informe rua, número, bairro e cidade para calcular a entrega.";
      return;
    }
    ctx.cotacao.temporizadorCotacao = setTimeout(() => {
      void ctx.cotarFrete(endereco).catch(() => { });
    }, 700);
  }
  Object.assign(ctx, { enderecoEntrega, chaveEndereco, atualizarTextoFrete, cotarFrete, agendarCotacaoFrete });
}
