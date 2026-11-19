import { el, reais } from "../../pdv/interface/elementos.mjs";
import { abas, hora, descreverRegistro } from "../regras/registros.mjs";

export function configurarRenderizacao(ctx) {
  function linha(titulo, descricao, valor) {
    const item = document.createElement("li");
    const corpo = document.createElement("div");
    const nome = document.createElement("strong");
    const detalhe = document.createElement("small");
    const total = document.createElement("span");
    nome.textContent = titulo;
    detalhe.textContent = descricao;
    total.textContent = reais(valor);
    corpo.append(nome, detalhe);
    item.append(corpo, total);
    return item;
  }

  function renderizarLista() {
    if (!ctx.estado.dados) return;
    ctx.escrever("titulo-lista-monitor", abas[ctx.estado.aba]);
    const registros = ctx.estado.dados[ctx.estado.aba];
    el("lista-monitor").replaceChildren(...registros.map(registro => {
      const { titulo, descricao, valor } = descreverRegistro(registro, ctx.estado.aba);
      return linha(titulo, descricao, valor);
    }));
    const total = ctx.estado.dados[ctx.estado.aba + "_total"];
    ctx.escrever("nota-lista-monitor", !total ? "Nenhum registro neste dia." :
      total > registros.length ? `Mostrando os ${registros.length} registros mais recentes de ${total}.` : "");
  }

  function renderizarAlertasSaldo(alertas) {
    const lista = el("lista-alertas-saldo-monitor");
    const textos = alertas.map(alerta => `Pedido #${alerta.comanda} · Despacho bloqueado às ${hora.format(new Date(alerta.atualizado_em))}`);
    if (textos.join("\n") !== Array.from(lista.children, item => item.textContent).join("\n")) {
      lista.replaceChildren(...textos.map(texto => {
        const item = document.createElement("li");
        item.textContent = texto;
        return item;
      }));
    }
    el("alertas-saldo-monitor").hidden = !alertas.length;
  }

  function renderizarMetricas() {
    ctx.escrever("total-monitor", ctx.estado.dados.pedidos_total);
    ctx.escrever("preparo-monitor", `${ctx.estado.dados.em_preparo} em preparo`);
    ctx.escrever("recebido-monitor", reais(Number(ctx.estado.dados.recebido_caixa) + Number(ctx.estado.dados.recebido_online)));
    ctx.escrever("origens-monitor", `Caixa ${reais(ctx.estado.dados.recebido_caixa)} · Online ${reais(ctx.estado.dados.recebido_online)}`);
    ctx.escrever("rota-monitor", ctx.estado.dados.em_rota);
    ctx.escrever("entregues-monitor", `${ctx.estado.dados.entregues} com entrega concluída`);
    ctx.renderizarLista();
    ctx.renderizarAlertasSaldo(ctx.estado.dados.alertas_saldo_remo ?? []);
    ctx.escrever("sincronizado-monitor", `Atualizado às ${hora.format(new Date())} · horário de Brasília`);
  }
  Object.assign(ctx, { renderizarLista, renderizarAlertasSaldo, renderizarMetricas });
}
