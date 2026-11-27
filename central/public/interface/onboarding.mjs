import { criarEmpresa, opcoesOnboardingLicenca } from "../dados/central.mjs";

import { exibirLinkGestor } from "./link-gestor.mjs";

export function onboarding(atualizar, sair) {
  const dialogo = document.getElementById("nova-empresa");
  const form = dialogo.querySelector("form");
  const aviso = document.getElementById("estado-onboarding");
  const salvar = form.querySelector("button[type=submit]");
  const cancelar = document.getElementById("cancelar-onboarding");
  const link = document.createElement('div');
  aviso.after(link);
  let tentativa, versao = 0;
  const modalidade = document.getElementById("onboarding-modalidade");
  const acao = form.elements.acao;
  const campoCnpj = document.getElementById("onboarding-cnpj");
  const legado = document.getElementById("onboarding-legado");
  function modo() {
    const trial = acao.value === "criar_trial" && !acao.disabled;
    campoCnpj.hidden = form.elements.cnpj.disabled = !trial;
    legado.hidden = legado.disabled = trial;
  }
  acao.onchange = modo;
  document.getElementById("abrir-onboarding").onclick = async () => {
    const atual = versao;
    dialogo.showModal();
    try {
      const opcoes = await opcoesOnboardingLicenca();
      if (atual !== versao || !dialogo.open) return;
      modalidade.hidden = acao.disabled = opcoes.trial !== true;
    } catch { /* O formulário legado continua disponível. */ }
  };
  cancelar.onclick = () => fechar();
  dialogo.addEventListener('close',() => { if (salvar.hidden) fechar(); });
  dialogo.addEventListener("cancel", evento => { if (salvar.disabled) evento.preventDefault(); });
  form.onsubmit = async evento => {
    evento.preventDefault();
    if (salvar.hidden || salvar.disabled) return;
    const atual = versao;
    const dados = Object.fromEntries(new FormData(form));
    if (dados.acao !== "criar_trial") dados.preco_centavos = Math.round(Number(dados.preco_centavos) * 100);
    const assinatura = JSON.stringify(dados);
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
    aviso.textContent = "";
    salvar.disabled = cancelar.disabled = true;
    try {
      const resultado = await criarEmpresa({ ...dados, requisicao: tentativa.id });
      if (versao !== atual) return;
      if (resultado.modo === "convite") {
        salvar.hidden = true;
        cancelar.textContent = "Fechar";
        aviso.textContent = resultado.token ? "Empresa registrada. Aguardando aceite do gestor."
          : "Empresa já registrada. Consulte o convite na ficha da empresa.";
        exibirLinkGestor(link,resultado.token);
        atualizar();
        return;
      }
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
    modalidade.hidden = acao.disabled = true;
    modo();
    aviso.textContent = "";
    link.replaceChildren();
    salvar.hidden = false;
    cancelar.textContent = "Cancelar";
    tentativa = undefined;
    salvar.disabled = cancelar.disabled = false;
  }
  return fechar;
}
