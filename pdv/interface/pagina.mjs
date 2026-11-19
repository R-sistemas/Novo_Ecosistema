import { carregarAdministracao } from "../dados/pagina.mjs";

async function iniciarPagina() {
  const login = document.getElementById("login");
  try {
    const parcial = document.createElement("template");
    parcial.innerHTML = await carregarAdministracao();
    if (!parcial.content.querySelector("#area-administracao")) {
      throw new Error("Estrutura da administração inválida.");
    }
    document.querySelector('template[data-pdv-parcial="administracao"]').replaceWith(parcial.content);
    await import("../../pdv.mjs");
    login.inert = false;
  } catch {
    login.inert = true;
    const recarregar = document.createElement("button");
    recarregar.type = "button";
    recarregar.className = "secondary";
    recarregar.textContent = "Recarregar";
    recarregar.onclick = () => location.reload();
    document.getElementById("notice").replaceChildren(
      document.createTextNode("Não foi possível abrir o PDV. Verifique sua conexão e recarregue a página. "),
      recarregar,
    );
  }
}

void iniciarPagina();
