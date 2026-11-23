import { prepararNavegacao } from "./navegacao-loja.mjs";
import { prepararMesas } from "./mesas.mjs";
import { prepararVisao } from "./visao.mjs";
import { prepararFinanceiro } from "./financeiro.mjs";
import { prepararEntregas } from "./entregas.mjs";
import { prepararPedidos } from "./pedidos.mjs";
import { prepararCredencialMP } from "./credencial-mp.mjs";
import { prepararPreferencias } from "./preferencias.mjs";
import { prepararEquipe } from "./equipe.mjs";
import { consultarProdutos, entrar, gravarProduto, lojasDoGestor, verificarLoja } from "../dados/catalogo.mjs";
import { prepararEditor } from "./formulario-produto.mjs";
import { paraReais } from "../../pdv/regras/moeda.mjs";
const el = id => document.getElementById(id);
const navegacao = prepararNavegacao();
const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const mensagens = {
  400: "Confira os dados do produto.", 401: "Sua sessão terminou. Entre novamente.",
  403: "Somente gestores da loja podem acessar o catálogo.",
  404: "Produto indisponível nesta loja.", 409: "Esse código já está em uso na loja."
};
const mensagem = falha => mensagens[falha.status] || "Não foi possível acessar o catálogo.";
const aviso = texto => { el("status").textContent = texto; };
const falha = texto => { el("erro").textContent = texto; };
let empresa;
let cursores = [null];
let indice = 0;
let proximo;
let consultando = false;
let lojaAutorizada = false;
let areaAtiva = "catalogo";
let produtosDaPagina = [];
const carregarEquipe = prepararEquipe(el("area-equipe"),aviso);
const mostrarCredencialMP = prepararCredencialMP(el("area-preferencias"));
const carregarPreferencias = prepararPreferencias(el("area-preferencias"),aviso);
const financeiro = prepararFinanceiro(el("area-financeiro"));
const entregas = prepararEntregas(el("area-entregas"));
const pedidos = prepararPedidos(el("area-pedidos"));
const mesas = prepararMesas(el("area-mesas"));
const visao = prepararVisao(el("area-visao"),{
  pedidos:(campos,intervalo)=>mostrarArea("pedidos",{campos,intervalo}),
  catalogo:()=>mostrarArea("catalogo",{ativos:true})
});
async function mostrarArea(area,opcoes={}) {
  if (!lojaAutorizada || consultando) return;
  pedidos.limparDetalhe();
  entregas.limpar();
  financeiro.limpar();
  areaAtiva = area;
  navegacao.selecionar(area);
  falha("");
  if (area === "catalogo") {
    el("catalogo-ativos").checked = opcoes.ativos === true;
    await carregar(opcoes.ativos ? null : cursores[indice],opcoes.ativos ? 0 : indice);
  }
  else if (area === "equipe") await carregarEquipe(empresa);
  else if (area === "preferencias") { mostrarCredencialMP(empresa); await carregarPreferencias(empresa); }
  else if (area === "financeiro") await financeiro.abrirLoja(empresa);
  else if (area === "entregas") await entregas.abrirLoja(empresa);
  else if (area === "pedidos") await pedidos.abrirLoja(empresa,opcoes.campos,opcoes.intervalo);
  else if (area === "visao") await visao(empresa);
  else await mesas(empresa);
}
el("aba-mesas").onclick = () => mostrarArea("mesas");
el("aba-visao").onclick = () => mostrarArea("visao");
el("aba-financeiro").onclick = () => mostrarArea("financeiro");
el("aba-entregas").onclick = () => mostrarArea("entregas");
el("aba-pedidos").onclick = () => mostrarArea("pedidos");
el("aba-catalogo").onclick = () => mostrarArea("catalogo");
el("aba-equipe").onclick = () => mostrarArea("equipe");
el("aba-preferencias").onclick = () => mostrarArea("preferencias");
const editar = prepararEditor(el("editor"), async (id, dados) => {
  try { await gravarProduto(empresa, id, dados); }
  catch (erro) { throw new Error(mensagem(erro)); }
  aviso(id ? "Produto atualizado." : "Produto cadastrado.");
  await carregar(cursores[indice], indice);
});

function comandos(habilitado) {
  el("novo").disabled = !habilitado;
  el("catalogo-ativos").disabled = !habilitado;
  el("anterior").disabled = !habilitado || indice === 0;
  el("proxima").disabled = !habilitado || !proximo;
  el("loja").disabled = consultando;
  for (const aba of ["catalogo","equipe","preferencias","pedidos","entregas","financeiro","visao","mesas"]) el("aba-" + aba).disabled = consultando || !lojaAutorizada;
}

function renderizar() {
  const produtos = produtosDaPagina.filter(p=>!el("catalogo-ativos").checked || p.ativo);
  const linhas = produtos.map(produto => {
    const tr = document.createElement("tr");
    const valores = [
      produto.nome, produto.codigo, produto.categoria || "—",
      dinheiro.format(paraReais(produto.preco_centavos)) + (produto.vendido_por_peso ? "/kg" : ""),
      produto.ativo ? "Ativo" : "Inativo", produto.visivel_cardapio ? "Visível" : "Oculto",
      produto.queridinho ? "Sim" : "Não"
    ];
    for (const valor of valores) tr.insertCell().textContent = valor;
    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = "Editar";
    botao.setAttribute("aria-label", "Editar " + produto.nome);
    botao.onclick = () => editar(produto);
    tr.insertCell().append(botao);
    return tr;
  });
  el("produtos").replaceChildren(...linhas);
  el("vazio").hidden = linhas.length !== 0;
}

async function carregar(cursor, pagina) {
  consultando = true;
  comandos(false);
  falha("");
  el("produtos").replaceChildren();
  el("vazio").hidden = true;
  let habilitado = false;
  try {
    const dados = await consultarProdutos(empresa, cursor);
    indice = pagina;
    cursores[indice] = cursor;
    proximo = dados.proximo_cursor;
    el("pagina").textContent = "Página " + (indice + 1);
    produtosDaPagina = dados.produtos;
    renderizar();
    habilitado = true;
  } catch (erro) {
    falha(mensagem(erro));
  } finally {
    consultando = false;
    comandos(habilitado);
  }
}

async function selecionarLoja() {
  if (consultando) return;
  lojaAutorizada = false;
  mostrarCredencialMP();
  pedidos.limparDetalhe();
  entregas.limpar();
  financeiro.limpar();
  el("area-financeiro").hidden = el("area-entregas").hidden = true;
  el("area-mesas").hidden = el("area-pedidos").hidden = el("area-visao").hidden = true;
  el("area-catalogo").hidden = el("area-equipe").hidden = el("area-preferencias").hidden = true;
  empresa = el("loja").value;
  cursores = [null];
  indice = 0;
  proximo = null;
  consultando = true;
  comandos(false);
  falha("");
  aviso("");
  el("produtos").replaceChildren();
  el("vazio").hidden = true;
  el("pagina").textContent = "";
  try {
    await verificarLoja(empresa);
  } catch (erro) {
    consultando = false;
    comandos(false);
    falha(mensagem(erro));
    return;
  }
  lojaAutorizada = true;
  consultando = false;
  comandos(true);
  await mostrarArea(areaAtiva);
}

el("login").addEventListener("submit", async evento => {
  evento.preventDefault();
  const form = evento.currentTarget;
  const botao = form.querySelector("button");
  if (botao.disabled) return;
  botao.disabled = true;
  falha("");
  try {
    await entrar(form.elements.email.value, form.elements.senha.value);
    const lojas = await lojasDoGestor();
    const solicitada = new URLSearchParams(location.search).get("empresa_id");
    if (!lojas.length || (solicitada && !lojas.some(loja => loja.id === solicitada))) throw Object.assign(new Error(), { status: 403 });
    el("loja").replaceChildren(...lojas.map(loja => new Option(loja.nome, loja.id)));
    if (solicitada) el("loja").value = solicitada;
    form.hidden = true;
    el("catalogo").hidden = false;
    navegacao.revelar();
    await selecionarLoja();
  } catch (erro) {
    falha(erro.status === 400 || erro.status === 401 ? "Confira o e-mail e a senha." : mensagem(erro));
  } finally {
    form.elements.senha.value = "";
    botao.disabled = false;
  }
});

el("loja").addEventListener("change", selecionarLoja);
el("catalogo-ativos").onchange = renderizar;
el("novo").onclick = () => editar();
el("anterior").onclick = () => carregar(cursores[indice - 1], indice - 1);
el("proxima").onclick = () => carregar(proximo, indice + 1);
el("sair").onclick = () => location.reload();
