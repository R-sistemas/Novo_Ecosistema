import { el } from "../../pdv/interface/elementos.mjs";
import { api } from "../dados/monitor.mjs";

export function configurarSessao(ctx) {
  function mostrarLogin(mensagem = "") {
    ctx.painel.hidden = ctx.dadosMonitor.hidden = ctx.sair.hidden = true;
    ctx.login.hidden = false;
    ctx.estado.dados = undefined;
    ctx.loja.replaceChildren();
    el("lista-monitor").replaceChildren();
    ctx.escrever("nome-monitor", "Monitor do gestor");
    ctx.aviso.textContent = mensagem;
  }

  function abrir({ lojas }) {
    ctx.loja.replaceChildren(...lojas.map(empresa => new Option(empresa.nome, empresa.id)));
    el("filtro-loja").hidden = lojas.length === 1;
    ctx.painel.hidden = ctx.sair.hidden = false;
    ctx.login.hidden = true;
    ctx.mudarFiltro();
  }

  ctx.login.onsubmit = async evento => {
    evento.preventDefault();
    const botao = ctx.login.querySelector("button");
    const senha = el("senha-monitor");
    botao.disabled = true;
    ctx.aviso.textContent = "Entrando…";
    try { ctx.abrir(await api("entrar", { email: el("email-monitor").value.trim(), senha: senha.value })); }
    catch (erro) { ctx.mostrarLogin(erro.status ? erro.message : "Não foi possível entrar. Confira a conexão."); }
    finally { senha.value = ""; botao.disabled = false; }
  };
  ctx.sair.onclick = async () => {
    ctx.estado.encerrando = ctx.sair.disabled = true;
    try {
      // Espere uma eventual renovação de sessão antes de limpar os cookies.
      await ctx.estado.consultaAtual;
      await api("sair");
      ctx.mostrarLogin("Você saiu do monitor.");
    } catch { ctx.aviso.textContent = "Não foi possível sair. Confira a conexão e tente novamente."; }
    finally { ctx.estado.encerrando = ctx.sair.disabled = false; }
  };
  Object.assign(ctx, { mostrarLogin, abrir });
  api("lojas").then(ctx.abrir).catch(erro => ctx.mostrarLogin(erro.status === 401 ? "" :
    erro.status ? erro.message : "Não foi possível carregar o monitor. Confira a conexão."));
}
