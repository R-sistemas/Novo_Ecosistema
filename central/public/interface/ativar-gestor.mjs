import { definirSenhaGestor } from "../dados/central.mjs";

const parametros = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", location.pathname);
let token = parametros.get("type") === "invite" ? parametros.get("access_token") : null;
const formulario = document.getElementById("ativacao");
const estado = document.getElementById("estado-ativacao");
formulario.hidden = !token;
if (!token) estado.textContent = "Convite indisponível. Solicite um novo acesso à Administração Central.";

formulario.onsubmit = async evento => {
  evento.preventDefault();
  const { senha, confirmacao } = formulario.elements;
  if (senha.value !== confirmacao.value) {
    estado.textContent = "As senhas devem coincidir.";
    return;
  }
  const botao = formulario.querySelector("button");
  botao.disabled = true;
  try {
    await definirSenhaGestor(token, senha.value);
    token = null;
    formulario.reset();
    formulario.hidden = true;
    document.getElementById("painel-loja").hidden = false;
    estado.textContent = "Senha definida. Entre no painel com seu e-mail.";
  } catch (erro) {
    estado.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
};
