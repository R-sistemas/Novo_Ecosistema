import { criarMinhaConta, entrar } from "../../supabase-pdv.mjs";
import { responderConvite } from "../dados/convites.mjs";

const el = id => document.getElementById("convite-" + id);
const parametros = new URLSearchParams(location.hash.slice(1));
const primeiroGestor = parametros.has("gestor");
const token = parametros.get(primeiroGestor ? "gestor" : "convite");
if (location.hash) history.replaceState(null, "", location.pathname);
const form = el("login");
const status = el("status");
const detalhes = el("detalhes");
let ocupado = false;

function mostrar(dados) {
  const pendente = dados.estado === "pendente";
  form.hidden = true;
  detalhes.hidden = !pendente;
  el("loja").textContent = dados.loja;
  el("perfil").textContent = ({vendas:"Vendas",cozinha:"Cozinha",gestor:"Gestor"})[dados.perfil] + (dados.caixa ? " · " + dados.caixa : "");
  el("emissor").textContent = "Enviado por " + dados.emissor;
  status.textContent = pendente ? "" : dados.estado === "aceito" ? "Convite aceito para " + dados.loja + "." : "Convite recusado.";
  const continuar = el("continuar");
  continuar.hidden = dados.estado !== "aceito";
  continuar.href = ({vendas:"/",cozinha:"/kds.html",gestor:"/admin-loja.html"})[dados.perfil] + "?empresa_id=" + encodeURIComponent(dados.empresa_id);
  continuar.textContent = ({vendas:"Ir para o PDV",cozinha:"Ir para o KDS",gestor:"Ir para o painel da loja"})[dados.perfil];
}

async function operar(acao) {
  if (ocupado) return;
  ocupado = true;
  const controles = [...document.querySelectorAll("button")];
  controles.forEach(botao => { botao.disabled = true; });
  status.textContent = "";
  try { await acao(); }
  finally {
    ocupado = false;
    form.elements.senha.value = "";
    controles.forEach(botao => { botao.disabled = false; });
  }
}

async function consultar(acao) {
  try { mostrar(await responderConvite(token, acao, primeiroGestor)); }
  catch (erro) {
    status.textContent = erro.status === 409
      ? "A loja precisa revisar o terminal ou o vínculo antes de concluir este convite."
      : "Convite indisponível para esta conta. Confira a conta e solicite um novo link à loja.";
  }
}

form.onsubmit = evento => {
  evento.preventDefault();
  void operar(async () => {
    try { await entrar(form.elements.email.value.trim(), form.elements.senha.value); }
    catch { status.textContent = "Confira o e-mail e a senha ou confirme a conta pelo Supabase Auth."; return; }
    await consultar("consultar");
  });
};
el("criar").onclick = () => {
  if (!form.reportValidity()) return;
  void operar(async () => {
    if (form.elements.senha.value.length < 12 || new TextEncoder().encode(form.elements.senha.value).length > 72) {
      status.textContent = "Escolha uma senha de 12 a 72 caracteres, com até 72 bytes.";
      return;
    }
    try {
      if (await criarMinhaConta(form.elements.email.value.trim(), form.elements.senha.value)) {
        await consultar("consultar");
        return;
      }
    } catch { /* A resposta é genérica para preservar a privacidade da conta. */ }
    status.textContent = "Se a conta for nova, conclua a confirmação do Auth. Depois volte a este convite e entre com a sua senha.";
  });
};
el("aceitar").onclick = () => operar(() => consultar("aceitar"));
el("recusar").onclick = () => operar(() => consultar("recusar"));
el("trocar-conta").onclick = () => {
  detalhes.hidden = true;
  form.hidden = false;
  status.textContent = "";
  form.elements.email.focus();
};
form.hidden = !/^[0-9a-f]{64}$/.test(token ?? "");
if (form.hidden) status.textContent = "Abra o link de convite enviado pela loja para continuar.";
