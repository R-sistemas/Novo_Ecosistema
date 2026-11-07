const modais = new Map();
const ids = ["aparencia-cardapio", "configurar-mesa", "cadastrar-operador", "configurar-pdv",
  "configurar-terminal", "cadastro-produto", "configuracao-entrega"];

for (const id of ids) {
  const formulario = document.getElementById(id);
  const modal = document.createElement("dialog");
  modal.className = "admin-modal";
  const titulo = formulario.querySelector("h2");
  titulo.id = id + "-titulo";
  modal.setAttribute("aria-labelledby", titulo.id);
  const fechar = document.createElement("button");
  fechar.type = "button";
  fechar.className = "secondary admin-modal-fechar";
  fechar.textContent = "Fechar";
  fechar.onclick = () => modal.close();
  const status = document.createElement("p");
  status.className = "admin-modal-status";
  status.setAttribute("role", "status");
  formulario.before(modal);
  modal.append(fechar, formulario, status);
  modais.set(id, { modal, status });
}

export function abrirAdmin(id) {
  const { modal, status } = modais.get(id);
  if (modal.open) return;
  status.textContent = "";
  modal.showModal();
}

export function modalAdminAtivo() {
  return [...modais.values()].find(({ modal }) => modal.open);
}
