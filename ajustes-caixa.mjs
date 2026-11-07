import { executar } from "./supabase-pdv.mjs";
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

const resumo = a => `Comanda ${a.comanda} · ${a.cliente} · ${a.operacao} ${a.quantidade} × ${a.produto_nome} · ${a.motivo}`;

export async function carregarAjustesCaixa() {
  if (el("area-vendas").hidden || el("operacao").hidden) return;
  const empresa = el("empresa").value;
  const atual = ++consulta;
  try {
    const ajustes = await executar("ajustes_pendentes_caixa", { p_empresa: empresa });
    if (atual !== consulta || empresa !== el("empresa").value) return;
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
      botao.onclick = () => abrir(ajuste);
      linha.append(texto, botao);
      return linha;
    }));
  } catch (erro) {
    if (atual !== consulta || empresa !== el("empresa").value) return;
    exibido = undefined;
    painel.hidden = false;
    el("lista-ajustes-caixa").textContent = "Falha ao consultar ajustes. " + erro.message;
  }
}

function abrir(ajuste) {
  selecionado = ajuste;
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
  if (dialogo.inert) return;
  dialogo.inert = true;
  try {
    await executar("resolver_ajuste_comanda", {
      p_id: selecionado.id, p_aplicar: decisao.value === "aplicar", p_resolucao: el("nota-ajuste-caixa").value.trim()
    });
    dialogo.close();
    el("notice").textContent = "Decisão registrada na comanda.";
    void carregarAjustesCaixa();
    void carregarCozinha();
  } catch (erro) {
    aviso.textContent = erro.message;
  } finally {
    dialogo.inert = false;
  }
};
el("fechar-ajuste-caixa").onclick = () => dialogo.close();
