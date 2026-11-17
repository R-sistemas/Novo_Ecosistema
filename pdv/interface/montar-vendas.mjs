import { configurarComandas } from "./comandas.mjs";
import { configurarAcertos } from "./acertos.mjs";
import { configurarPagamento } from "./pagamento.mjs";
import { configurarBuscaProdutos } from "./busca-produtos.mjs";
import { configurarAdicionais } from "./adicionais.mjs";
import { configurarCancelamentos } from "../../cancelar-comanda.mjs";
import { carregarCozinha } from "../../cozinha.mjs";
import { carregarAjustesCaixa } from "../../ajustes-caixa.mjs";

export function montarVendas(ctx) {
  const {
    el,
    reais,
    meios,
    estado,
    carrinho,
    botao,
    operar,
    atualizar,
    atualizarTotalFrente,
    renderizar,
    opcoesPagamento,
    pixFrente,
    dialogoPesagem,
    total,
    desconto,
    renderizarProdutos,
    adicionarProduto,
    ocupado,
  } = ctx;
  const { carregarComandas, receberPedido } = configurarComandas({
    el,
    reais,
    meios,
    estado,
    carrinho,
    botao,
    operar,
    atualizar,
    carregarCozinha,
    limparPagamento: () => limparPagamento(),
    renderizar,
    atualizarTotalFrente,
    abrirPagamento: (...args) => abrirPagamento(...args),
    comandaAberta: ctx.comandaAberta,
    setComandaAberta: (valor) => {
      ctx.setComandaAberta(valor);
    },
    vendaPendente: ctx.vendaPendente,
    adicionalPendente: ctx.adicionalPendente,
    area: ctx.area,
  });
  const carregarAcertos = configurarAcertos({
    el,
    botao,
    reais,
    operar,
    atualizar,
    carregarCozinha,
    estado,
    area: ctx.area,
  });
  setInterval(() => {
    if (document.hidden) return;
    void carregarComandas();
    void carregarAjustesCaixa();
    void carregarAcertos();
  }, 5000);
  const { abrirPagamento, limparPagamento } = configurarPagamento({
    el,
    opcoesPagamento,
    pixFrente,
    estado,
    carrinho,
    meios,
    dialogoPesagem,
    operar,
    total,
    desconto,
    atualizarTotalFrente,
    renderizar,
    atualizar,
    reais,
    receberPedido: (...args) => receberPedido(...args),
    vendaPendente: ctx.vendaPendente,
    setVendaPendente: (valor) => {
      ctx.setVendaPendente(valor);
    },
    meioSelecionado: ctx.meioSelecionado,
    setMeioSelecionado: (valor) => {
      ctx.setMeioSelecionado(valor);
    },
    comandaAberta: ctx.comandaAberta,
    ambientePixFrente: ctx.ambientePixFrente,
    produtos: ctx.produtos,
    area: ctx.area,
    ocupado,
  });
  configurarBuscaProdutos({
    el,
    renderizarProdutos,
    adicionarProduto,
    produtos: ctx.produtos,
  });
  limparPagamento();
  renderizar();
  configurarCancelamentos({
    comandaAtual: ctx.comandaAberta,
    atualizar: (id, resultado) => {
      if (resultado === "cancelado" && ctx.comandaAberta()?.id === id) {
        ctx.setComandaAberta(undefined);
        ctx.setAdicionalPendente(undefined);
        carrinho.clear();
        limparPagamento();
        renderizar();
      }
      void carregarComandas();
      void carregarCozinha();
    },
  });
  configurarAdicionais({
    el,
    operar,
    estado,
    carrinho,
    limparPagamento,
    renderizar,
    carregarComandas: () => carregarComandas(),
    comandaAberta: ctx.comandaAberta,
    setComandaAberta: (valor) => {
      ctx.setComandaAberta(valor);
    },
    adicionalPendente: ctx.adicionalPendente,
    setAdicionalPendente: (valor) => {
      ctx.setAdicionalPendente(valor);
    },
    produtos: ctx.produtos,
  });

  return { abrirPagamento, limparPagamento, carregarComandas, carregarAcertos };
}
