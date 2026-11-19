import { el } from "../../pdv/interface/elementos.mjs";
import { criarEstadoMonitor } from "../regras/estado.mjs";
import { formatarDia } from "../regras/registros.mjs";
import { configurarRenderizacao } from "./renderizacao.mjs";
import { configurarAtualizacao } from "./atualizacao.mjs";
import { configurarEventos } from "./eventos.mjs";
import { configurarSessao } from "./sessao.mjs";

export function iniciarMonitor() {
  const ctx = {
    estado: criarEstadoMonitor(),
    login: el("login-monitor"),
    painel: el("painel-monitor"),
    dadosMonitor: el("dados-monitor"),
    loja: el("loja-monitor"),
    dia: el("dia-monitor"),
    aviso: el("aviso-monitor"),
    sair: el("sair-monitor"),
    escrever: (id, valor) => { el(id).textContent = valor; }
  };
  ctx.dia.value = ctx.dia.max = formatarDia.format(new Date());
  configurarRenderizacao(ctx);
  configurarAtualizacao(ctx);
  configurarEventos(ctx);
  configurarSessao(ctx);
}
