import { executar } from "./supabase-pdv.mjs";

const el = id => document.getElementById(id);
const etapas = { novo: "Novo", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue" };

export function configurarCancelamentos({ comandaAtual, atualizar }) {
  const dialogo = el("dialogo-cancelamentos");
  const busca = el("buscar-cancelamentos");
  const formulario = el("form-cancelamento");
  const motivo = el("motivo-cancelamento");
  const rotulo = el("rotulo-motivo-cancelamento");
  const decisao = el("resultado-cancelamento");
  const aviso = el("aviso-cancelamento");
  const empresa = () => el("empresa").value;
  let selecionada;
  let tentativa;

  function escolher(comanda, gestor) {
    selecionada = comanda;
    formulario.reset();
    formulario.hidden = false;
    el("comanda-cancelamento").textContent = `Mesa ${comanda.mesa} · Comanda ${comanda.comanda} · ${comanda.cliente}` +
      (comanda.solicitacao ? ` · Motivo informado: ${comanda.motivo}` : "");
    el("decisao-cancelamento").hidden = !comanda.solicitacao;
    el("confirmar-cancelamento").textContent = comanda.solicitacao ? "Registrar decisão" :
      comanda.iniciou_preparo && !gestor ? "Solicitar autorização" : "Confirmar cancelamento";
    aviso.textContent = "";
    atualizarMotivo();
    (comanda.solicitacao ? decisao : motivo).focus();
  }

  function atualizarMotivo() {
    const ocultar = Boolean(selecionada?.solicitacao && decisao.value === "aprovar");
    motivo.hidden = rotulo.hidden = motivo.disabled = ocultar;
    rotulo.textContent = selecionada?.solicitacao ? "Motivo da negativa" : "Motivo do cancelamento";
  }

  async function carregar() {
    formulario.hidden = true;
    const { comandas, gestor, historico } = await executar("comandas_para_cancelar", {
      p_empresa: empresa(), p_busca: el("numero-cancelamentos").value
    });
    const lista = el("lista-cancelamentos");
    lista.replaceChildren(...comandas.map(comanda => {
      const linha = document.createElement("div");
      linha.className = "row";
      const resumo = document.createElement("p");
      resumo.textContent = `Mesa ${comanda.mesa} · Comanda ${comanda.comanda} · ${comanda.cliente} · ${etapas[comanda.estado]}` +
        (comanda.solicitacao ? " · Aguardando autorização" : "");
      linha.append(resumo);
      if (!comanda.solicitacao || gestor) {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "secondary";
        botao.textContent = comanda.solicitacao ? "Revisar solicitação" : "Selecionar para cancelar";
        botao.onclick = () => escolher(comanda, gestor);
        linha.append(botao);
      }
      return linha;
    }));
    if (!comandas.length) lista.textContent = "Nenhuma comanda disponível para cancelamento nesta busca.";
    el("historico-cancelamentos").hidden = !historico.length;
    el("lista-historico-cancelamentos").replaceChildren(...historico.map(item => {
      const linha = document.createElement("li");
      const horario = new Date(item.horario).toLocaleString("pt-BR");
      linha.textContent = `Comanda ${item.comanda} · ${item.estado === "cancelado" ? "Cancelada" : "Cancelamento negado"} · ${horario}. ` +
        `Solicitado por ${item.solicitado_por}. Decidido por ${item.resolvido_por}. Motivo: ${item.motivo}` +
        (item.decisao ? `. Negativa: ${item.decisao}` : "");
      return linha;
    }));
  }

  async function executarNoDialogo(acao) {
    if (dialogo.inert) return;
    dialogo.inert = true;
    aviso.textContent = "";
    try { await acao(); }
    catch (erro) { aviso.textContent = erro.message; }
    finally { dialogo.inert = false; }
  }

  function abrir(numero) {
    busca.reset();
    el("numero-cancelamentos").value = numero ?? "";
    el("lista-cancelamentos").replaceChildren();
    el("historico-cancelamentos").hidden = true;
    dialogo.showModal();
    void executarNoDialogo(carregar);
  }

  el("abrir-cancelamentos-caixa").onclick = () => abrir(comandaAtual()?.comanda);
  el("abrir-cancelamentos-gestor").onclick = () => abrir();
  el("fechar-cancelamentos").onclick = () => dialogo.close();
  dialogo.addEventListener("cancel", evento => { if (dialogo.inert) evento.preventDefault(); });
  decisao.onchange = atualizarMotivo;
  busca.onsubmit = evento => { evento.preventDefault(); void executarNoDialogo(carregar); };
  formulario.onsubmit = evento => {
    evento.preventDefault();
    void executarNoDialogo(async () => {
      const comanda = selecionada;
      let resultado;
      if (comanda.solicitacao) {
        const aprovar = decisao.value === "aprovar";
        await executar("resolver_cancelamento_comanda", { p_empresa: empresa(), p_id: comanda.solicitacao,
          p_aprovar: aprovar, p_decisao: aprovar ? null : motivo.value.trim() });
        resultado = aprovar ? "cancelado" : "negado";
      } else {
        const dados = { p_empresa: empresa(), p_pedido: comanda.id, p_motivo: motivo.value.trim() };
        const chave = JSON.stringify(dados);
        if (tentativa?.chave !== chave) tentativa = { chave, id: crypto.randomUUID() };
        resultado = await executar("solicitar_cancelamento_comanda", { ...dados, p_id: tentativa.id });
        tentativa = undefined;
      }
      atualizar(comanda.id, resultado);
      const mensagens = { cancelado: "Comanda cancelada. A cozinha foi avisada.",
        pendente: "Solicitação enviada ao gestor. O preparo está pausado.", negado: "Cancelamento negado. A comanda voltou ao fluxo." };
      await carregar();
      aviso.textContent = mensagens[resultado];
    });
  };
}
