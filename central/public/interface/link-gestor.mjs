export function exibirLinkGestor(area, token) {
  area.replaceChildren();
  if (!token) return;
  const url = new URL("https://novo-ecossistema.vercel.app/convite-equipe.html");
  url.hash = new URLSearchParams({ gestor: token });
  const campo = document.createElement("input");
  campo.readOnly = true;
  campo.value = url.href;
  campo.setAttribute("aria-label", "Link do primeiro gestor");
  const copiar = document.createElement("button");
  copiar.type = "button";
  copiar.textContent = "Copiar link do gestor";
  copiar.onclick = async () => {
    try { await navigator.clipboard.writeText(campo.value); copiar.textContent = "Link copiado"; }
    catch { campo.select(); }
  };
  area.append(campo, copiar);
}
