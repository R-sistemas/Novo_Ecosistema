import { modalAdminAtivo } from "../../administracao.mjs";

export function configurarOperacao({ el }) {
  let ocupado = false;
  async function operar(acao, fecharModal = false) {
    if (ocupado) return;
    ocupado = true;
    const admin = modalAdminAtivo();
    el("operacao").inert = true;
    if (admin) {
      admin.modal.inert = true;
      admin.status.textContent = "Aguarde…";
    }
    try {
      const mensagem = await acao();
      if (admin && fecharModal) admin.modal.close();
      (admin && !fecharModal ? admin.status : el("notice")).textContent = mensagem;
    } catch (erro) {
      (admin?.status ?? el("notice")).textContent = erro.message;
    } finally {
      ocupado = false;
      el("operacao").inert = false;
      if (admin) admin.modal.inert = false;
    }
  }
  return { operar, ocupado: () => ocupado };
}
