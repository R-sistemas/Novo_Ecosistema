import { entrar, lojasDoGestor } from "../dados/catalogo.mjs";
import { vigiarVinculos } from "../../equipe/interface/vigiar-vinculos.mjs";
import { lojaInicial } from "../../equipe/regras/loja-inicial.mjs";
import { preencherSeletorLojas } from "../../equipe/interface/seletor-loja.mjs";

export function prepararAcessoLoja({ el, navegacao, selecionarLoja, falha, mensagem, empresa, versao, invalidar }) {
  vigiarVinculos({empresa,versao,consultar:lojasDoGestor,revogado(lojas) {
    preencherSeletorLojas(el("loja"),lojas);
    invalidar();
    falha(lojas.length ? "Acesso à loja encerrado. Escolha outro estabelecimento." :
      "Seu usuário ainda não tem acesso ao painel de uma loja.");
  }});
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
      if (!lojas.length) { falha("Seu usuário ainda não tem acesso ao painel de uma loja."); return; }
      preencherSeletorLojas(el("loja"), lojas, lojaInicial(lojas, solicitada));
      form.hidden = true;
      el("catalogo").hidden = false;
      navegacao.revelar();
      await selecionarLoja();
      if (!el("loja").value) el("loja").focus();
    } catch (erro) {
      falha(erro.status === 400 || erro.status === 401 ? "Confira o e-mail e a senha." : mensagem(erro));
    } finally {
      form.elements.senha.value = "";
      botao.disabled = false;
    }
  });
}
