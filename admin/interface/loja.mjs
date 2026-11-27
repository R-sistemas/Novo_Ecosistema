import { prepararAcessoLoja } from "./acesso-loja.mjs";
import { prepararNavegacao } from "./navegacao-loja.mjs";
import { prepararMesas } from "./mesas.mjs";
import { prepararVisao } from "./visao.mjs";
import { prepararFinanceiroLoja } from "./financeiro-loja.mjs";
import { prepararEntregas } from "./entregas.mjs";
import { prepararPedidos } from "./pedidos.mjs";
import { prepararCredencialMP } from "./credencial-mp.mjs";
import { prepararPreferencias } from "./preferencias.mjs";
import { prepararEquipe } from "./equipe.mjs";
import { consultarProdutos, gravarProduto, verificarLoja } from "../dados/catalogo.mjs";
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
let geracaoLoja = 0;
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
const financeiro = prepararFinanceiroLoja(el("area-financeiro"),
  () => comandos(lojaAutorizada && !consultando), () => areaAtiva === "financeiro");
const entregas = prepararEntregas(el("area-entregas"));
const pedidos = prepararPedidos(el("area-pedidos"));
const mesas = prepararMesas(el("area-mesas"));
const visao = prepararVisao(el("area-visao"),{
  pedidos:(campos,intervalo)=>mostrarArea("pedidos",{campos,intervalo}),
  catalogo:()=>mostrarArea("catalogo",{ativos:true})
});
async function mostrarArea(area,opcoes={}) {
  if (!lojaAutorizada || consultando || (financeiro.somenteLicenca() && area !== "financeiro")) return;
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
  for (const aba of ["catalogo","equipe","preferencias","pedidos","entregas","financeiro","visao","mesas"]) el("aba-" + aba).disabled = consultando || !lojaAutorizada || (financeiro.somenteLicenca() && aba !== "financeiro");
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
  const atual = geracaoLoja;
  consultando = true;
  comandos(false);
  falha("");
  el("produtos").replaceChildren();
  el("vazio").hidden = true;
  let habilitado = false;
  try {
    const dados = await consultarProdutos(empresa, cursor);
    if (atual !== geracaoLoja) return;
    indice = pagina;
    cursores[indice] = cursor;
    proximo = dados.proximo_cursor;
    el("pagina").textContent = "Página " + (indice + 1);
    produtosDaPagina = dados.produtos;
    renderizar();
    habilitado = true;
  } catch (erro) {
    if (atual === geracaoLoja) falha(mensagem(erro));
  } finally {
    if (atual === geracaoLoja) {
      consultando = false;
      comandos(habilitado);
    }
  }
}

async function selecionarLoja() {
  if (consultando) return;
  const atual = ++geracaoLoja;
  lojaAutorizada = false;
  financeiro.limparLoja();
  mostrarCredencialMP();
  pedidos.limparDetalhe();
  entregas.limpar();
  el("area-financeiro").hidden = el("area-entregas").hidden = true;
  el("area-mesas").hidden = el("area-pedidos").hidden = el("area-visao").hidden = true;
  el("area-catalogo").hidden = el("area-equipe").hidden = el("area-preferencias").hidden = true;
  void carregarEquipe();
  for (const dialogo of document.querySelectorAll("dialog[open]")) dialogo.close();
  empresa = el("loja").value;
  el("loja-ativa").textContent = empresa ? "" : "Escolher estabelecimento";
  produtosDaPagina = [];
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
  if (!empresa) { consultando = false; comandos(false); return; }
  try {
    await verificarLoja(empresa);
    if (atual !== geracaoLoja) return;
    await financeiro.carregarLicenca(empresa);
    if (atual !== geracaoLoja) return;
  } catch (erro) {
    if (atual !== geracaoLoja) return;
    consultando = false;
    el("loja").value = "";
    void selecionarLoja();
    falha(mensagem(erro));
    return;
  }
  lojaAutorizada = true;
  el("loja-ativa").textContent = el("loja").selectedOptions[0].textContent;
  consultando = false;
  comandos(true);
  await mostrarArea(financeiro.somenteLicenca() ? "financeiro" : areaAtiva);
}

prepararAcessoLoja({ el, navegacao, selecionarLoja, falha, mensagem, empresa: () => empresa,
  versao: () => geracaoLoja, invalidar() { consultando = false; void selecionarLoja(); } });

el("loja").addEventListener("change", selecionarLoja);
el("catalogo-ativos").onchange = renderizar;
el("novo").onclick = () => editar();
el("anterior").onclick = () => carregar(cursores[indice - 1], indice - 1);
el("proxima").onclick = () => carregar(proximo, indice + 1);
el("sair").onclick = () => location.reload();
