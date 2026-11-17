import { montarAdmin } from "./montar-admin.mjs";
import { montarAcesso } from "./montar-acesso.mjs";
import { montarVendas } from "./montar-vendas.mjs";
import { el, reais, botao } from "./elementos.mjs";
import { estado, carrinho, meios } from "../regras/estado.mjs";
import {
  precoAdicional as calcularPrecoAdicional,
  subtotal as calcularSubtotal,
  desconto as calcularDesconto,
  total as calcularTotal,
  temItens as verificarItens,
} from "../regras/valores.mjs";
import { configurarOperacao } from "./operacao.mjs";
import { configurarAtualizacao } from "./atualizacao.mjs";
import { configurarOperacaoCaixa } from "./operacao-caixa.mjs";
import { configurarRenderizacao } from "./renderizacao.mjs";
import { configurarItensFrente } from "./itens-frente.mjs";
import { configurarCatalogoFrente } from "./catalogo-frente.mjs";
import { configurarPesagem } from "../../pesagem.mjs";
import { configurarPixFrente } from "./pix-frente.mjs";
import { configurarRecebimentosOnline } from "../../recebimentos-online.mjs";

let produtos = [];
let usuario;
let empresasGerenciadas = new Set();
let vendaPendente;
let meioSelecionado;
let area;
let terminais = [];
let catalogoAdmin = [];
let comandaAberta;
let adicionalPendente;
let ambientePixFrente;
const carregarRecebimentosOnline = configurarRecebimentosOnline(() => el("empresa").value);
const dialogoPesagem = el("dialogo-pesagem");
const pesagem = configurarPesagem(el("campos-pesagem"));
const opcoesPagamento = [...document.querySelectorAll("[data-meio-pdv]")];
const pixFrente = configurarPixFrente({
  el,
  reais,
  estado,
  carrinho,
  opcoesPagamento,
  abrirPagamento: (...args) => vendas.abrirPagamento(...args),
  setMeioSelecionado: (valor) => { meioSelecionado = valor; },
  produtos: () => produtos,
  renderizar: () => renderizar(),
  setComandaAberta: (valor) => { comandaAberta = valor; },
  limparPagamento: () => vendas.limparPagamento(),
  atualizar: () => atualizar(),
  carregarComandas: () => vendas.carregarComandas(),
});
const precoAdicional = (produto) => calcularPrecoAdicional(comandaAberta, produto);
const subtotal = () => calcularSubtotal(pixFrente.atual(), comandaAberta, produtos, carrinho);
const desconto = () => calcularDesconto(comandaAberta, empresasGerenciadas.has(el("empresa").value), el("valor-desconto").valueAsNumber);
const total = () => calcularTotal(pixFrente.atual(), subtotal(), desconto());
const temItens = () => verificarItens(comandaAberta, carrinho.size, pixFrente.atual());
const atualizar = configurarAtualizacao({
  el,
  estado,
  pixFrente,
  renderizar: () => renderizar(),
  renderizarCatalogoAdmin: () => admin.renderizarCatalogoAdmin(),
  carregarAparencia: (config) => admin.carregarAparencia(config),
  carregarRecebimentosOnline,
  area: () => area,
  usuario: () => usuario,
  setTerminais: (valor) => { terminais = valor; },
  setAmbientePixFrente: (valor) => { ambientePixFrente = valor; },
  setCatalogoAdmin: (valor) => { catalogoAdmin = valor; },
  setProdutos: (valor) => { produtos = valor; },
});
const { operar, ocupado } = configurarOperacao({ el });
const admin = montarAdmin({ el, botao, reais, operar, atualizar, catalogoAdmin: () => catalogoAdmin });
const renderizarProdutos = configurarCatalogoFrente({
  el,
  botao,
  reais,
  dialogoPesagem,
  produtos: () => produtos,
  adicionarProduto: (produto) => adicionarProduto(produto),
});
const { adicionarProduto, abrirPesagem } = configurarItensFrente({
  el,
  carrinho,
  pixFrente,
  estado,
  pesagem,
  dialogoPesagem,
  reais,
  renderizar: () => renderizar(),
  comandaAberta: () => comandaAberta,
  vendaPendente: () => vendaPendente,
  adicionalPendente: () => adicionalPendente,
  carregarComandas: () => vendas.carregarComandas(),
});
const { renderizar, atualizarTotalFrente } = configurarRenderizacao({
  el,
  reais,
  botao,
  estado,
  carrinho,
  pixFrente,
  opcoesPagamento,
  temItens,
  precoAdicional,
  subtotal,
  total,
  desconto,
  renderizarProdutos,
  abrirPesagem,
  operarCaixa: (acao) => operarCaixa(acao),
  comandaAberta: () => comandaAberta,
  produtos: () => produtos,
  ambientePixFrente: () => ambientePixFrente,
  empresasGerenciadas: () => empresasGerenciadas,
  adicionalPendente: () => adicionalPendente,
  vendaPendente: () => vendaPendente,
  meioSelecionado: () => meioSelecionado,
});
const operarCaixa = configurarOperacaoCaixa({
  el,
  estado,
  operar,
  atualizar,
  temItens,
});
montarAcesso({
  el,
  operar,
  atualizar,
  estado,
  carrinho,
  renderizar,
  temItens,
  vendas: () => vendas,
  setUsuario: (valor) => { usuario = valor; },
  setEmpresasGerenciadas: (valor) => { empresasGerenciadas = valor; },
  empresasGerenciadas: () => empresasGerenciadas,
  setArea: (valor) => { area = valor; },
  area: () => area,
  setComandaAberta: (valor) => { comandaAberta = valor; },
  setVendaPendente: (valor) => { vendaPendente = valor; },
  vendaPendente: () => vendaPendente,
  setProdutos: (valor) => { produtos = valor; },
  terminais: () => terminais,
});
const vendas = montarVendas({
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
  comandaAberta: () => comandaAberta,
  setComandaAberta: (valor) => { comandaAberta = valor; },
  vendaPendente: () => vendaPendente,
  setVendaPendente: (valor) => { vendaPendente = valor; },
  adicionalPendente: () => adicionalPendente,
  setAdicionalPendente: (valor) => { adicionalPendente = valor; },
  meioSelecionado: () => meioSelecionado,
  setMeioSelecionado: (valor) => { meioSelecionado = valor; },
  area: () => area,
  ambientePixFrente: () => ambientePixFrente,
  produtos: () => produtos,
});
