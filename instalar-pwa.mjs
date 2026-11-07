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

let instalacao;
window.addEventListener("beforeinstallprompt", evento => {
  evento.preventDefault();
  instalacao = evento;
  botao.hidden = false;
});
botao.onclick = async () => {
  const evento = instalacao;
  instalacao = undefined;
  botao.hidden = true;
  if (evento) await evento.prompt();
};
window.addEventListener("appinstalled", () => {
  instalacao = undefined;
  botao.hidden = true;
});
