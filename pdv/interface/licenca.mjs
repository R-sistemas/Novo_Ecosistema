import { consultarLicencaPdv } from "../dados/licenca.mjs";

const mensagens = {
  em_debito: "Mensalidade em débito.",
  bloqueada_parcial: "Mensalidade em débito. O cardápio está fechado para novos pedidos.",
  bloqueada_total: "Operação suspensa. Novos caixas e vendas estão bloqueados."
};

export function configurarLicencaPdv({ el, estado, area, renderizar }) {
  const aviso = document.createElement("p");
  aviso.id = "licenca-pdv";
  aviso.className = "panel";
  aviso.setAttribute("role", "status");
  aviso.hidden = true;
  let selecionada;
  let consulta = 0;

  async function atualizar() {
    const empresa = el("empresa").value;
    if (!empresa || area() !== "vendas") {
      aviso.hidden = true;
      return;
    }
    if (selecionada !== empresa) {
      selecionada = empresa;
      aviso.hidden = true;
      estado.licencaBloqueada = false;
    }
    const versao = ++consulta;
    try {
      const situacao = await consultarLicencaPdv(empresa);
      if (versao !== consulta || el("empresa").value !== empresa || area() !== "vendas") return;
      aviso.textContent = mensagens[situacao] ?? "";
      if (aviso.textContent && !aviso.isConnected) el("operacao").prepend(aviso);
      aviso.hidden = !aviso.textContent;
      const bloqueada = situacao === "bloqueada_total";
      if (estado.licencaBloqueada !== bloqueada) {
        estado.licencaBloqueada = bloqueada;
        renderizar();
      }
    } catch {
      // A consulta é informativa. As operações continuam sujeitas às regras do banco.
    }
  }

  setInterval(() => { if (!document.hidden && !el("operacao").hidden) void atualizar(); }, 60000);
  return atualizar;
}
