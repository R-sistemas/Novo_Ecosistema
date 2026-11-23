import { criarEmpresa } from "../dados/central.mjs";

export function onboarding(atualizar, sair) {
  const dialogo = document.getElementById("nova-empresa");
  const form = dialogo.querySelector("form");
  const aviso = document.getElementById("estado-onboarding");
  const salvar = form.querySelector("button[type=submit]");
  const cancelar = document.getElementById("cancelar-onboarding");
  let tentativa, versao = 0;
  document.getElementById("abrir-onboarding").onclick = () => dialogo.showModal();
  cancelar.onclick = () => dialogo.close();
  dialogo.addEventListener("cancel", evento => { if (salvar.disabled) evento.preventDefault(); });
  form.onsubmit = async evento => {
    evento.preventDefault();
    const atual = versao;
    const dados = Object.fromEntries(new FormData(form));
    dados.preco_centavos = Math.round(Number(dados.preco_centavos) * 100);
    const assinatura = JSON.stringify(dados);
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
    aviso.textContent = "";
    salvar.disabled = cancelar.disabled = true;
    try {
      await criarEmpresa({ ...dados, requisicao: tentativa.id });
      if (versao !== atual) return;
      fechar();
      atualizar();
    } catch (e) {
      if (versao !== atual) return;
      if ([401, 403].includes(e.status)) sair();
      else aviso.textContent = e.message;
    } finally {
      if (versao === atual) salvar.disabled = cancelar.disabled = false;
    }
  };

  function fechar() {
    versao++;
    dialogo.close();
    form.reset();
    aviso.textContent = "";
    tentativa = undefined;
    salvar.disabled = cancelar.disabled = false;
  }
  return fechar;
}
