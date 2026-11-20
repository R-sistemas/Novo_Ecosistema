const botao = document.getElementById("instalar-pwa");
const loja = new URLSearchParams(location.search).get("loja");
if (location.pathname === "/cardapio.html" && loja && loja.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(loja)) {
  const manifesto = document.createElement("link");
  manifesto.rel = "manifest";
  manifesto.href = "/api/foto-cardapio?" + new URLSearchParams({ manifesto: "1", loja });
  document.head.append(manifesto);
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/pwa-sw.js").catch(() => {});
}

if (botao && document.querySelector('link[rel="manifest"]')) {
  prepararInstalacao(botao);
}

function prepararInstalacao(botao) {
  const standalone = matchMedia("(display-mode: standalone)");
  let instalacao, dialogo, instalado = false;

  function atualizar() {
    botao.hidden = instalado || standalone.matches || navigator.standalone === true;
  }
  function instrucoes() {
    if (!dialogo) {
      dialogo = document.createElement("dialog");
      dialogo.setAttribute("aria-labelledby","titulo-instalar-pwa");
      const titulo = document.createElement("h2");
      titulo.id = "titulo-instalar-pwa";
      titulo.textContent = botao.textContent.trim();
      const passos = document.createElement("p");
      passos.textContent = "Abra o menu ⋮ do navegador e escolha Instalar app. No Safari, use Compartilhar e depois Adicionar à Tela de Início.";
      const fechar = document.createElement("button");
      fechar.type = "button";
      fechar.className = "secondary secundario";
      fechar.textContent = "Fechar";
      fechar.onclick = () => dialogo.close();
      dialogo.append(titulo,passos,fechar);
      document.body.append(dialogo);
    }
    if (!dialogo.open) dialogo.showModal();
  }

  window.addEventListener("beforeinstallprompt", evento => {
    evento.preventDefault();
    if (!instalado) instalacao = evento;
  });
  window.addEventListener("appinstalled", () => {
    instalado = true;
    instalacao = undefined;
    if (dialogo?.open) dialogo.close();
    atualizar();
  });
  standalone.addEventListener("change",atualizar);

  botao.onclick = async () => {
    const evento = instalacao;
    instalacao = undefined;
    if (!evento) {
      instrucoes();
      return;
    }
    botao.disabled = true;
    try {
      await evento.prompt();
    } catch {
      if (!botao.hidden) instrucoes();
    } finally {
      botao.disabled = false;
    }
  };
  atualizar();
}
