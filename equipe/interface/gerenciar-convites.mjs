import { gerenciarConvites, listarConvites } from "../dados/convites.mjs";

export function prepararConvites(painel) {
  const lista = painel.querySelector("[data-convites]");
  const aviso = painel.querySelector("[data-aviso-convites]");
  const acesso = document.createElement("section");
  acesso.hidden = true;
  lista.after(acesso);
  let empresa, compartilhado, geracao = 0, ocupado = false;
  const solicitacoes = new Map();

  function compartilhar(id, token) {
    compartilhado = id;
    const url = new URL("/convite-equipe.html", location.origin);
    url.hash = "convite=" + token;
    const link = document.createElement("input");
    link.value = url.href;
    link.readOnly = true;
    link.setAttribute("aria-label", "Link do convite");
    const copiar = document.createElement("button");
    copiar.type = "button";
    copiar.textContent = "Copiar link";
    copiar.onclick = async () => {
      try { await navigator.clipboard.writeText(link.value); aviso.textContent = "Link copiado."; }
      catch { link.select(); aviso.textContent = "Copie o endereço selecionado."; }
    };
    const whatsapp = document.createElement("a");
    whatsapp.href = "https://wa.me/?" + new URLSearchParams({text: "Aceite o convite da equipe: " + url.href});
    whatsapp.target = "_blank";
    whatsapp.rel = "noopener noreferrer";
    whatsapp.textContent = "Enviar pelo WhatsApp";
    acesso.replaceChildren(link, copiar, whatsapp);
    acesso.hidden = false;
  }

  async function operar(acao, dados) {
    if (ocupado || !empresa) return;
    const atual = geracao;
    const loja = empresa;
    const operacao = JSON.stringify([acao,dados]);
    const requisicao = solicitacoes.get(operacao) ?? crypto.randomUUID();
    solicitacoes.set(operacao, requisicao);
    ocupado = true;
    aviso.textContent = "";
    try {
      const resposta = await gerenciarConvites(loja, acao, {...dados,requisicao});
      if (atual !== geracao) return;
      solicitacoes.delete(operacao);
      if (resposta.token) compartilhar(resposta.id, resposta.token);
      if (acao === "cancelar" && compartilhado === resposta.id) {
        acesso.replaceChildren();
        acesso.hidden = true;
        compartilhado = undefined;
      }
      aviso.textContent = acao === "cancelar" ? "Convite cancelado." : resposta.token
        ? "Link disponível para compartilhar."
        : "Convite registrado. Use Reenviar para gerar um novo link.";
      try { renderizar(await listarConvites(loja), atual); }
      catch { if (atual === geracao) aviso.textContent += " Atualize a tela para conferir a lista."; }
      return true;
    } catch (erro) {
      if (atual !== geracao) return;
      if (erro.status && erro.status < 500) solicitacoes.delete(operacao);
      aviso.textContent = erro.status === 409 ? "Já existe um convite pendente ou a intenção mudou."
        : "Não foi possível confirmar a operação. Confira a lista antes de repetir.";
    } finally {
      if (atual === geracao) ocupado = false;
    }
  }

  function botao(titulo, convite, acao) {
    const elemento = document.createElement("button");
    elemento.type = "button";
    elemento.textContent = titulo;
    elemento.onclick = () => operar(acao, {id: convite.id});
    return elemento;
  }

  function renderizar(dados, atual) {
    if (atual !== geracao) return;
    lista.replaceChildren(...dados.convites.map(convite => {
      const item = document.createElement("li");
      item.textContent = [convite.email, convite.perfil === "vendas" ? "Vendas" : "Cozinha", convite.caixa, convite.estado]
        .filter(Boolean).join(" · ");
      if (convite.estado === "pendente" || convite.estado === "expirado") {
        if (dados.habilitado) item.append(" ", botao("Reenviar e gerar novo link", convite, "reenviar"));
        item.append(" ", botao("Cancelar convite", convite, "cancelar"));
      }
      return item;
    }));
    painel.hidden = dados.legado;
  }

  async function carregar(loja) {
    const atual = ++geracao;
    empresa = loja;
    compartilhado = undefined;
    ocupado = false;
    solicitacoes.clear();
    aviso.textContent = "";
    lista.replaceChildren();
    acesso.replaceChildren();
    acesso.hidden = painel.hidden = true;
    if (!loja) return;
    const dados = await listarConvites(loja);
    renderizar(dados, atual);
    return atual === geracao ? dados : undefined;
  }

  return {carregar, emitir: dados => operar("emitir", dados)};
}
