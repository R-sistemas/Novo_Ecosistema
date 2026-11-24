import { redefinirSenha, solicitarRecuperacaoSenha } from "../../supabase-pdv.mjs";

const solicitar = document.getElementById("solicitar-recuperacao");
const definir = document.getElementById("definir-nova-senha");
const estado = document.getElementById("status");
const titulo = document.getElementById("titulo-area");
const parametros = new URLSearchParams(location.hash.slice(1));
if (location.hash) history.replaceState(null, "", location.pathname);
let token = parametros.get("type") === "recovery" ? parametros.get("access_token") : null;
solicitar.hidden = Boolean(token);
definir.hidden = !token;
if (token) titulo.textContent = "Definir nova senha";
else if (parametros.has("error") || parametros.has("type")) {
  estado.textContent = "Link indisponível. Solicite um novo link abaixo.";
}

solicitar.onsubmit = async evento => {
  evento.preventDefault();
  const botao = solicitar.querySelector("button");
  botao.disabled = true;
  try {
    const destino = new URL("/recuperar-senha.html", location.origin);
    await solicitarRecuperacaoSenha(solicitar.elements.email.value.trim(), destino.href);
    solicitar.reset();
    solicitar.hidden = true;
    titulo.textContent = "Solicitação concluída";
    estado.textContent = "Se o e-mail estiver cadastrado, o link foi enviado. Confira sua caixa de entrada e a pasta de spam.";
    titulo.focus();
  } catch (erro) {
    estado.textContent = erro.status === 429 ? "O limite de envio foi atingido. Confira se já recebeu um link. Aguarde antes de solicitar outro."
      : "Não foi possível enviar a solicitação. Tente novamente.";
  } finally {
    botao.disabled = false;
  }
};

definir.onsubmit = async evento => {
  evento.preventDefault();
  const { senha, confirmacao } = definir.elements;
  if (senha.value !== confirmacao.value || new TextEncoder().encode(senha.value).length > 72) {
    estado.textContent = "As senhas devem coincidir e ter no máximo 72 bytes.";
    return;
  }
  const botao = definir.querySelector("button");
  botao.disabled = true;
  try {
    await redefinirSenha(token, senha.value);
    token = null;
    definir.reset();
    definir.hidden = true;
    estado.textContent = "Senha alterada. Volte ao login e entre com sua nova senha.";
  } catch (erro) {
    if ([401, 403].includes(erro.status)) {
      token = null;
      definir.reset();
      definir.hidden = true;
      solicitar.hidden = false;
      titulo.textContent = "Recuperar senha";
      estado.textContent = "Link indisponível. Solicite um novo link abaixo.";
    } else {
      estado.textContent = "Não foi possível alterar a senha. Confira os requisitos ou tente novamente.";
    }
  } finally {
    botao.disabled = false;
  }
};