import { vigiaDaLoja } from "./pdv/regras/contexto-loja.mjs";
import { executar, executarApi } from "./supabase-pdv.mjs";
import { estadosEntrega } from "./estado-entrega.mjs";
import { criarAlertaPedidos } from "./alerta-pedidos.mjs";
import { imprimirCozinha } from "./impressao-cozinha.mjs";
import { contatoPedido } from "./kds/interface/contato-pedido.mjs";

const fila = document.getElementById("fila-cozinha");
const aviso = document.getElementById("aviso-cozinha");
const avisoImpressao = document.getElementById("aviso-impressao-kds") || aviso;
const alerta = criarAlertaPedidos(aviso);
const empresa = document.getElementById("empresa");
const kds = document.body.dataset.area === "kds";
const etapas = { novo: "Novo", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue" };
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const acoes = {
  novo: [["preparo", "Iniciar preparo"], ["recusado", "Recusar"]],
  preparo: [["pronto", "Marcar pronto"]],
  pronto: [["entregue", "Marcar entregue"]],
  entregue: []
};
let empresaExibida;
let ultimaFila;
let ultimosCancelamentos;
let carregando;
const falhasDespacho = new Map();
const painelCancelamentos = document.getElementById("cancelamentos-kds");
const listaCancelamentos = document.getElementById("lista-cancelamentos-kds");

function exibirCancelamentos(cancelamentos) {
  if (!painelCancelamentos) return;
  const atual = JSON.stringify(cancelamentos);
  if (atual === ultimosCancelamentos) return;
  ultimosCancelamentos = atual;
  painelCancelamentos.hidden = !cancelamentos.length;
  listaCancelamentos.replaceChildren(...cancelamentos.map(cancelamento => {
    const linha = document.createElement("li");
    const horario = new Date(cancelamento.horario).toLocaleTimeString("pt-BR", {hour: "2-digit", minute: "2-digit"});
    linha.textContent = `Comanda ${cancelamento.comanda} · Mesa ${cancelamento.mesa} · Cancelada às ${horario}`;
    return linha;
  }));
}

export async function carregarCozinha() {
  const idEmpresa = empresa.value;
  if (idEmpresa !== empresaExibida) {
    empresaExibida = idEmpresa;
    ultimaFila = undefined;
    fila.replaceChildren();
    exibirCancelamentos([]);
  }
  if (!idEmpresa || carregando?.() || document.getElementById("area-vendas").hidden) return;
  const vigente = vigiaDaLoja(empresa);
  carregando = vigente;
  try {
    const [pedidos, cancelamentos] = await Promise.all([
      executar("fila_cozinha", { p_empresa: idEmpresa }),
      kds ? executar("cancelamentos_recentes_kds", { p_empresa: idEmpresa }) : []
    ]);
    if (!vigente()) return;
    alerta.atualizar(idEmpresa, pedidos);
    exibirCancelamentos(cancelamentos);
    aviso.textContent = pedidos.length ? "" : "Nenhum pedido em andamento.";
    const atual = JSON.stringify(pedidos);
    if (atual === ultimaFila) return;
    ultimaFila = atual;
    fila.replaceChildren(...pedidos.map(pedido => {
      const artigo = document.createElement("article");
      const titulo = document.createElement("h3");
      const modalidade = pedido.pagamento_entrega ? "Entrega" : pedido.mesa ? "Mesa " + pedido.mesa : "Retirada";
      titulo.textContent = (pedido.adicional ? "Adicionais · " : "") + pedido.cliente + " · " + modalidade;
      if (pedido.comanda) titulo.textContent += " · Comanda " + pedido.comanda;
      const resumo = document.createElement("p");
      resumo.textContent = pedido.itens.map(item => item.quantidade + " × " + item.nome).join(", ") || "Sem itens originais para preparar.";
      const financeiro = document.createElement("p");
      financeiro.textContent = pedido.pix_teste ? "Pagamento confirmado no Sandbox" : pedido.recebido ? "Recebimento registrado" :
        pedido.pagamento_entrega === "na_entrega" ? "Pagamento na entrega pendente" :
        pedido.estado === "entregue" ? "Entregue · recebimento pendente" : "Recebimento pendente";
      const etapa = document.createElement("p");
      etapa.textContent = pedido.cancelamento_pendente ? "Preparo pausado · Cancelamento em análise" :
        pedido.ajuste_pendente ? "Aguardando resolução de ajuste" : estadosEntrega[pedido.estado_remo] ?? etapas[pedido.estado];
      if (pedido.estado === "pronto" && pedido.pagamento_entrega && !pedido.estado_remo) {
        etapa.textContent = falhasDespacho.get(pedido.id) || "Pronto · Aguardando despacho à REMO";
      }
      etapa.className = "etapa-kds";
      artigo.append(titulo, etapa, resumo);
      if (kds && !pedido.adicional) artigo.append(contatoPedido(pedido,idEmpresa,carregarCozinha));
      if (!kds) artigo.append(financeiro);
      if (kds && pedido.edita_comanda && !pedido.cancelamento_pendente) {
        const editar = document.createElement("button");
        editar.type = "button";
        editar.textContent = "Ajustar comanda";
        editar.onclick = () => fila.dispatchEvent(new CustomEvent("ajustar-comanda", { detail: pedido.comanda }));
        artigo.append(editar);
      }
      if (pedido.ajuste_pendente) return artigo;
      if (!kds && pedido.endereco_entrega) {
        const endereco = document.createElement("p");
        const { logradouro, numero, bairro, cidade, complemento, maps_url, telefone, metodo_pagamento, troco_para_centavos } = pedido.endereco_entrega;
        endereco.textContent = [logradouro, numero, bairro, cidade, complemento].filter(Boolean).join(", ") || "Entrega por pino no mapa";
        artigo.append(endereco);
        if (maps_url?.startsWith("https://www.google.com/maps?q=")) {
          const mapa = document.createElement("a");
          mapa.href = maps_url;
          mapa.target = "_blank";
          mapa.rel = "noopener noreferrer";
          mapa.textContent = "Abrir pino da entrega";
          artigo.append(mapa);
        }
        const contato = document.createElement("p");
        contato.textContent = [telefone && `Contato: ${telefone}`,
          metodo_pagamento && `Pagamento: ${{ pix: "Pix", credito: "Crédito online", dinheiro: "Dinheiro", maquininha: "Maquininha" }[metodo_pagamento] || metodo_pagamento}`,
          troco_para_centavos != null && `Troco para ${moeda.format(troco_para_centavos / 100)}`].filter(Boolean).join(" · ");
        if (contato.textContent) artigo.append(contato);
      }
      const avisoDespacho = document.createElement("p");
      avisoDespacho.setAttribute("role", "status");
      async function solicitarDespacho() {
        try {
          await executarApi("despachar-remo", { pedido: pedido.id });
          falhasDespacho.delete(pedido.id);
          avisoDespacho.textContent = "Despacho solicitado à REMO.";
          if (vigente()) await carregarCozinha();
        } catch (erro) {
          const mensagem = "Despacho pendente: " + erro.message;
          falhasDespacho.set(pedido.id, mensagem);
          avisoDespacho.textContent = mensagem;
        }
      }
      if (pedido.estado === "pronto" && pedido.pagamento_entrega && !pedido.estado_remo) {
        const despacho = document.createElement("button");
        despacho.type = "button";
        despacho.textContent = "Tentar despacho à REMO";
        despacho.onclick = async () => {
          despacho.disabled = true;
          await solicitarDespacho();
          despacho.disabled = false;
        };
        artigo.append(despacho, avisoDespacho);
      }
      if (!kds && !pedido.adicional && !pedido.recebido && !pedido.mesa && !pedido.pagamento_entrega) {
        const receber = document.createElement("button");
        receber.textContent = "Registrar recebimento no caixa";
        receber.onclick = () => fila.dispatchEvent(new CustomEvent("receber-pedido", {
          detail: { id: pedido.id, total: pedido.total_centavos }
        }));
        artigo.append(receber);
      }
      if (kds && ["preparo", "pronto"].includes(pedido.estado) && !pedido.cancelamento_pendente) {
        const reimprimir = document.createElement("button");
        reimprimir.type = "button";
        reimprimir.textContent = "Reimprimir pedido";
        reimprimir.onclick = () => {
          if (!window.confirm("Confirme que o pedido precisa de outra via impressa.")) return;
          avisoImpressao.textContent = imprimirCozinha(pedido, true).mensagem;
        };
        artigo.append(reimprimir);
      }
      for (const [destino, texto] of acoes[pedido.estado]) {
        if ((destino === "recusado" && (pedido.adicional || pedido.mesa || pedido.recebido)) ||
            (destino === "entregue" && (pedido.pagamento_entrega || (!pedido.recebido && !pedido.mesa)))) continue;
        const botao = document.createElement("button");
        botao.textContent = texto;
        botao.onclick = async () => {
          artigo.inert = true;
          try {
            await executar(pedido.adicional ? "avancar_adicional_comanda" : "avancar_pedido", { p_id: pedido.id, p_estado: destino });
            if (kds && destino === "preparo") {
              avisoImpressao.textContent = imprimirCozinha(pedido).mensagem;
            }
            if (destino === "pronto" && pedido.pagamento_entrega && !pedido.adicional) {
              await solicitarDespacho();
            }
            if (vigente()) await carregarCozinha();
          } catch (erro) {
            if (vigente()) aviso.textContent = erro.message;
          } finally {
            artigo.inert = false;
          }
        };
        artigo.append(botao);
      }
      return artigo;
    }));
  } catch (erro) {
    if (vigente()) aviso.textContent = "Falha ao atualizar a cozinha. " + erro.message;
  } finally {
    if (carregando === vigente) carregando = undefined;
  }
}

document.getElementById("operacao").addEventListener("invalidar-loja", () => {
  ultimaFila = empresaExibida = undefined;
  falhasDespacho.clear();
});
document.getElementById("atualizar-cozinha").onclick = carregarCozinha;
setInterval(() => {
  if (!document.hidden && !document.getElementById("operacao").hidden) void carregarCozinha();
}, 5000);
