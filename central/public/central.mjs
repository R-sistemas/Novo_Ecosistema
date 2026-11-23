import { autenticar } from "./interface/acesso.mjs";
import { inventario } from "./interface/inventario.mjs";
import { auditoria } from "./interface/auditoria.mjs";

const sair = () => acesso.sair("Sua sessão terminou ou o acesso foi revogado.");
const painel = inventario(sair);
const trilha = auditoria(sair);
const navInventario = document.getElementById("nav-inventario");
const navAuditoria = document.getElementById("nav-auditoria");

function mostrarInventario() {
  trilha.fechar();
  navAuditoria.removeAttribute("aria-current");
  navInventario.setAttribute("aria-current", "page");
  painel.abrir();
}

navInventario.addEventListener("click", () => {
  if (!document.getElementById("auditoria").hidden) mostrarInventario();
});
navAuditoria.onclick = () => {
  painel.fechar();
  navInventario.removeAttribute("aria-current");
  navAuditoria.setAttribute("aria-current", "page");
  trilha.abrir();
};
const acesso = autenticar(mostrarInventario, () => { painel.fechar(); trilha.fechar(); });
