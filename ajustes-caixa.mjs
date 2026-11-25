import { listarAjustesCaixa, resolverAjuste } from "./pdv/dados/comandas.mjs";
import { carregarCozinha } from "./cozinha.mjs";

const el = id => document.getElementById(id);
const painel = el("ajustes-caixa");
const dialogo = el("resolver-ajuste-caixa");
const formulario = el("form-resolver-ajuste");
const decisao = el("decisao-ajuste-caixa");
const aviso = el("aviso-ajuste-caixa");
let selecionado;
let exibido;
let consulta = 0;
let versaoLoja = 0;

export function invalidarAjustesCaixa() {
  versaoLoja++;
  consulta++;
  selecionado = undefined;
  exibido = undefined;
  dialogo.close();
  dialogo.inert = false;
  aviso.textContent = "";
  painel.hidden = true;
  el("lista-ajustes-caixa").replaceChildren();
}

const lojaAtual = ({ empresa, versao }) => empresa === el("empresa").value && versao === versaoLoja;

const resumo = a => `Comanda ${a.comanda} · ${a.cliente} · ${a.operacao} ${a.quantidade} × ${a.produto_nome} · ${a.motivo}`;

export async function carregarAjustesCaixa() {
  if (el("area-vendas").hidden || el("operacao").hidden) return;
  const empresa = el("empresa").value;
  const contexto = { empresa, versao: versaoLoja };
  const atual = ++consulta;
  try {
    const ajustes = await listarAjustesCaixa({ p_empresa: empresa });
    if (atual !== consulta || !lojaAtual(contexto)) return;
    const chave = JSON.stringify([empresa, ajustes]);
    if (chave === exibido) return;
    exibido = chave;
    painel.hidden = !ajustes.length;
    el("lista-ajustes-caixa").replaceChildren(...ajustes.map(ajuste => {
      const linha = document.createElement("div");
      linha.className = "row";
      const texto = document.createElement("p");
      texto.textContent = resumo(ajuste);
      const botao = document.createElement("button");
      botao.type = "button";
      botao.textContent = "Resolver ajuste";
      botao.onclick = () => { if (lojaAtual(contexto)) abrir(ajuste, contexto); };
      linha.append(texto, botao);
      return linha;
    }));
  } catch (erro) {
    if (atual !== consulta || !lojaAtual(contexto)) return;
    exibido = undefined;
    painel.hidden = false;
    el("lista-ajustes-caixa").textContent = "Falha ao consultar ajustes. " + erro.message;
  }
}

function abrir(ajuste, contexto) {
  if (dialogo.inert) return;
  selecionado = { ...contexto, id: ajuste.id };
  formulario.reset();
  decisao.options[0].disabled = ajuste.protegido;
  decisao.value = ajuste.protegido ? "encerrar" : "aplicar";
  aviso.textContent = "";
  const orientacao = ajuste.protegido ? " Trate cobrança, devolução ou despacho antes de encerrar a solicitação." :
    " Confirme o combinado com o cliente. A retirada de itens já em preparo, prontos ou entregues exige o gestor.";
  el("resumo-ajuste-caixa").textContent = resumo(ajuste) + "." + orientacao;
  dialogo.showModal();
}

formulario.onsubmit = async evento => {
  evento.preventDefault();
  const alvo = selecionado;
  if (dialogo.inert || !alvo || !lojaAtual(alvo)) return;
  dialogo.inert = true;
  try {
    await resolverAjuste({
      p_empresa: alvo.empresa, p_id: alvo.id, p_aplicar: decisao.value === "aplicar", p_resolucao: el("nota-ajuste-caixa").value.trim()
    });
    if (!lojaAtual(alvo)) return;
    dialogo.close();
    el("notice").textContent = "Decisão registrada na comanda.";
    void carregarAjustesCaixa();
    void carregarCozinha();
  } catch (erro) {
    if (lojaAtual(alvo)) aviso.textContent = erro.message;
  } finally {
    if (lojaAtual(alvo)) dialogo.inert = false;
  }
};
el("fechar-ajuste-caixa").onclick = () => dialogo.close();
