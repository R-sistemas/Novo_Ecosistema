import { el } from "../../pdv/interface/elementos.mjs";
import { api } from "../dados/monitor.mjs";

export function configurarAtualizacao(ctx) {
  async function atualizar() {
    if (ctx.painel.hidden || ctx.estado.consultando || ctx.estado.encerrando || !ctx.dia.validity.valid) return;
    const empresa = ctx.loja.value;
    const data = ctx.dia.value;
    ctx.estado.consultando = true;
    el("atualizar-monitor").disabled = true;
    if (ctx.dadosMonitor.hidden) ctx.aviso.textContent = "Atualizando operação…";
    try {
      const resposta = await api("consultar", { empresa, dia: data });
      if (ctx.estado.encerrando || ctx.loja.value !== empresa || ctx.dia.value !== data) return;
      ctx.estado.dados = resposta;
      ctx.renderizarMetricas();
      ctx.dadosMonitor.hidden = false;
      ctx.aviso.textContent = "";
    } catch (erro) {
      if (ctx.estado.encerrando) return;
      if ([401, 403].includes(erro.status)) ctx.mostrarLogin(erro.message);
      else ctx.aviso.textContent = "A atualização falhou. Confira a conexão ou toque em Atualizar.";
    } finally {
      ctx.estado.consultando = false;
      el("atualizar-monitor").disabled = false;
      if (ctx.loja.value !== empresa || ctx.dia.value !== data) ctx.solicitarAtualizacao();
    }
  }

  function mudarFiltro() {
    ctx.estado.dados = undefined;
    ctx.dadosMonitor.hidden = true;
    ctx.escrever("nome-monitor", ctx.loja.selectedOptions[0]?.text ?? "Monitor do gestor");
    if (!ctx.dia.validity.valid) ctx.aviso.textContent = "Selecione um dia válido.";
    else ctx.solicitarAtualizacao();
  }

  function solicitarAtualizacao() {
    if (!ctx.estado.consultando) ctx.estado.consultaAtual = ctx.atualizar();
  }
  Object.assign(ctx, { atualizar, mudarFiltro, solicitarAtualizacao });
}
