import { entrar, sair, verificar } from "../dados/central.mjs";

export function autenticar(abrir, fechar) {
  const acesso = document.querySelector("#acesso");
  const login = document.querySelector("#login");
  const mfa = document.querySelector("#mfa");
  const etapaLogin = document.querySelector("#etapa-login");
  const etapaMfa = document.querySelector("#etapa-mfa");
  const botaoSair = document.querySelector("#sair");
  const lateral = document.querySelector("#lateral");

  function aviso(id, campo, mensagem = "", invalido = false) {
    const caixa = document.querySelector("#aviso-" + id);
    caixa.hidden = !mensagem;
    document.querySelector("#erro-" + id).textContent = mensagem;
    if (invalido) campo.setAttribute("aria-invalid", "true");
    else campo.removeAttribute("aria-invalid");
  }

  function sessaoVisivel(ativa) {
    document.body.classList.toggle("plataforma", ativa);
    document.body.classList.toggle("acesso", !ativa);
    acesso.hidden = ativa;
    botaoSair.hidden = !ativa;
    lateral.hidden = !ativa;
  }

  function voltar(mensagem = "") {
    void sair();
    fechar();
    etapaLogin.hidden = false;
    etapaMfa.hidden = true;
    sessaoVisivel(false);
    aviso("acesso", login.elements.senha, mensagem);
    aviso("mfa", mfa.elements.codigo);
    mfa.reset();
    login.elements.email.focus();
  }

  login.onsubmit = async evento => {
    evento.preventDefault();
    const botao = login.querySelector("button");
    botao.disabled = true;
    aviso("acesso", login.elements.senha);
    try {
      const fatores = await entrar(login.elements.email.value, login.elements.senha.value);
      mfa.elements.fator.replaceChildren(...fatores.map((item, indice) =>
        new Option(item.nome || "Autenticador " + (indice + 1), item.id)));
      document.querySelector("#escolha-fator").hidden = fatores.length === 1;
      etapaLogin.hidden = true;
      etapaMfa.hidden = false;
      mfa.elements.codigo.focus();
    } catch (e) {
      const mensagem = e.status === 401 ? "Não foi possível entrar. Confira seu e-mail e senha." : e.message;
      aviso("acesso", login.elements.senha, mensagem, e.status === 401);
    } finally {
      login.elements.senha.value = "";
      botao.disabled = false;
    }
  };

  mfa.onsubmit = async evento => {
    evento.preventDefault();
    const botoes = [...mfa.querySelectorAll("button")];
    botoes.forEach(botao => { botao.disabled = true; });
    aviso("mfa", mfa.elements.codigo);
    try {
      await verificar(mfa.elements.fator.value, mfa.elements.codigo.value);
      sessaoVisivel(true);
      abrir();
    } catch (e) {
      const mensagem = e.status === 401 ? "Código inválido ou expirado. Tente novamente." : e.message;
      aviso("mfa", mfa.elements.codigo, mensagem, e.status === 401);
      mfa.elements.codigo.focus();
    } finally {
      mfa.elements.codigo.value = "";
      botoes.forEach(botao => { botao.disabled = false; });
    }
  };

  botaoSair.onclick = () => voltar();
  document.querySelector("#voltar").onclick = () => voltar();
  return { sair: voltar };
}
