import { lerConviteGestor, reenviarConviteGestor } from "../dados/central.mjs";
import { exibirLinkGestor } from "./link-gestor.mjs";

const estados = {
  pendente: "Aguardando aceite do gestor", aceito: "Convite aceito",
  expirado: "Convite expirado", recusado: "Convite recusado", cancelado: "Convite cancelado"
};
const rotulos = { emitir:"Emissão", reenviar:"Reenvio", aceitar:"Aceite", recusar:"Recusa" };

export function controlesConviteGestor(area, sair) {
  const secao = document.createElement("section");
  secao.hidden = true;
  area.before(secao);
  let versao = 0;

  function renderizar(convite, empresa, atual) {
    const titulo = document.createElement("h3");
    titulo.textContent = estados[convite.estado];
    const email = document.createElement("p");
    email.textContent = convite.email;
    const eventos = document.createElement("ul");
    for (const evento of convite.historico) {
      const item = document.createElement("li");
      item.textContent = [rotulos[evento.acao.split(".").at(-1)], "geração " + evento.geracao,
        new Date(evento.em).toLocaleString("pt-BR")].join(" · ");
      eventos.append(item);
    }
    const aviso = document.createElement("p");
    aviso.setAttribute("role","status");
    const link = document.createElement("div");
    const reenviar = document.createElement("button");
    reenviar.type = "button";
    reenviar.textContent = "Reenviar e gerar novo link";
    reenviar.hidden = !convite.reenvio_habilitado || !["pendente","expirado"].includes(convite.estado);
    let requisicao;
    reenviar.onclick = async () => {
      if (atual !== versao || reenviar.disabled) return;
      reenviar.disabled = true;
      requisicao ??= crypto.randomUUID();
      aviso.textContent = "";
      try {
        const resposta = await reenviarConviteGestor(empresa, requisicao);
        if (atual !== versao) return;
        requisicao = undefined;
        exibirLinkGestor(link,resposta.token);
        const { convite: vigente } = await lerConviteGestor(empresa);
        if (atual !== versao) return;
        if (!vigente) return;
        renderizar(vigente, empresa, atual);
        exibirLinkGestor(secao.querySelector("[data-link-gestor]"), resposta.token);
        secao.querySelector("[role=status]").textContent = resposta.token
          ? "Novo link gerado." : "Reenvio já registrado. Gere outro link para compartilhar.";
      } catch (erro) {
        if (atual !== versao) return;
        if (erro.status === 401) sair();
        else aviso.textContent = erro.message;
      } finally { reenviar.disabled = false; }
    };
    link.dataset.linkGestor = "";
    secao.replaceChildren(titulo,email,eventos,reenviar,aviso,link);
    secao.hidden = false;
  }

  return async registro => {
    const atual = ++versao;
    secao.hidden = true;
    secao.replaceChildren();
    if (!registro) return;
    try {
      const { convite } = await lerConviteGestor(registro.id);
      if (atual === versao && convite) renderizar(convite,registro.id,atual);
    } catch (erro) {
      if (atual !== versao) return;
      if (erro.status === 401) sair();
      else {
        const aviso = document.createElement("p");
        aviso.textContent = "Não foi possível consultar o convite do gestor.";
        secao.append(aviso);
        secao.hidden = false;
      }
    }
  };
}
