import { alterarSuspensao } from "../dados/central.mjs";

export function controlesSuspensao(atualizar, sair, bloquearEditor) {
  const formulario = document.getElementById("suspensao");
  const motivo = formulario.elements.motivo;
  const botoes = [...formulario.querySelectorAll("button")];
  const retorno = document.getElementById("erro-suspensao");
  let empresa;
  let tentativa;

  function mostrar(registro) {
    empresa = registro;
    tentativa = null;
    formulario.reset();
    retorno.textContent = "";
    formulario.hidden = !registro?.modo_suspensao;
    bloquearEditor(false);
    for (const botao of botoes) botao.disabled = botao.value === registro?.modo_suspensao;
  }

  formulario.onsubmit = async evento => {
    evento.preventDefault();
    const modo = evento.submitter?.value;
    if (!empresa || !modo || modo === empresa.modo_suspensao) return;
    const nota = motivo.value.trim();
    if (!nota) {
      retorno.textContent = "Informe o motivo da alteração.";
      motivo.focus();
      return;
    }
    const assinatura = JSON.stringify([modo, nota]);
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
    const atual = tentativa;
    bloquearEditor(true);
    botoes.forEach(botao => { botao.disabled = true; });
    retorno.textContent = "";
    try {
      await alterarSuspensao({ id: empresa.id, modo, revisao: empresa.revisao_suspensao, motivo: nota, requisicao: atual.id });
      if (tentativa === atual) atualizar();
    } catch (e) {
      if (tentativa !== atual) return;
      if ([401, 403].includes(e.status)) sair();
      else retorno.textContent = e.message;
    } finally {
      if (tentativa === atual) {
        bloquearEditor(false);
        for (const botao of botoes) botao.disabled = botao.value === empresa.modo_suspensao;
      }
    }
  };
  return mostrar;
}
