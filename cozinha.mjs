import { executar } from "./supabase-pdv.mjs";

const fila = document.getElementById("fila-cozinha");
const aviso = document.getElementById("aviso-cozinha");
const empresa = document.getElementById("empresa");
const kds = document.body.dataset.area === "kds";
const etapas = { novo: "Novo", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue" };
const acoes = {
  novo: [["preparo", "Iniciar preparo"], ["recusado", "Recusar"]],
  preparo: [["pronto", "Marcar pronto"]],
  pronto: [["entregue", "Marcar entregue"]],
  entregue: []
};
let empresaExibida;
let ultimaFila;
let carregando = false;

export async function carregarCozinha() {
  const idEmpresa = empresa.value;
  if (idEmpresa !== empresaExibida) {
    empresaExibida = idEmpresa;
    ultimaFila = undefined;
    fila.replaceChildren();
  }
  if (!idEmpresa || carregando || document.getElementById("area-vendas").hidden) return;
  carregando = true;
  try {
    const pedidos = await executar("fila_cozinha", { p_empresa: idEmpresa });
    if (empresa.value !== idEmpresa) return;
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
      etapa.textContent = pedido.ajuste_pendente ? "Aguardando resolução de ajuste" : etapas[pedido.estado];
      etapa.className = "etapa-kds";
      artigo.append(titulo, etapa, resumo);
      if (!kds) artigo.append(financeiro);
      if (kds && pedido.edita_comanda) {
        const editar = document.createElement("button");
        editar.type = "button";
        editar.textContent = "Ajustar comanda";
        editar.onclick = () => fila.dispatchEvent(new CustomEvent("ajustar-comanda", { detail: pedido.comanda }));
        artigo.append(editar);
      }
      if (pedido.ajuste_pendente) return artigo;
      if (!kds && pedido.endereco_entrega) {
        const endereco = document.createElement("p");
        const { logradouro, numero, bairro, cidade, complemento } = pedido.endereco_entrega;
        endereco.textContent = [logradouro, numero, bairro, cidade, complemento].filter(Boolean).join(", ");
        artigo.append(endereco);
        if (pedido.estado === "pronto") {
          const despacho = document.createElement("button");
          despacho.textContent = "Solicitar despacho à REMO";
          despacho.onclick = async () => {
            despacho.disabled = true;
            try {
              const id = await executar("solicitar_despacho_remo", { p_pedido: pedido.id });
              despacho.textContent = "Despacho solicitado";
              aviso.textContent = "Solicitação REMO " + id;
            } catch (erro) {
              aviso.textContent = erro.message;
              despacho.disabled = false;
            }
          };
          artigo.append(despacho);
        }
      }
      if (!kds && !pedido.adicional && !pedido.recebido && !pedido.mesa) {
        const receber = document.createElement("button");
        receber.textContent = "Registrar recebimento no caixa";
        receber.onclick = () => fila.dispatchEvent(new CustomEvent("receber-pedido", {
          detail: { id: pedido.id, total: pedido.total_centavos }
        }));
        artigo.append(receber);
      }
      for (const [destino, texto] of acoes[pedido.estado]) {
        if ((pedido.adicional && destino === "recusado") || (destino === "entregue" && !pedido.recebido && !pedido.mesa) || (destino === "recusado" && pedido.recebido)) continue;
        const botao = document.createElement("button");
        botao.textContent = texto;
        botao.onclick = async () => {
          artigo.inert = true;
          try {
            await executar(pedido.adicional ? "avancar_adicional_comanda" : "avancar_pedido", { p_id: pedido.id, p_estado: destino });
            if (empresa.value === idEmpresa) await carregarCozinha();
          } catch (erro) {
            if (empresa.value === idEmpresa) aviso.textContent = erro.message;
          } finally {
            artigo.inert = false;
          }
        };
        artigo.append(botao);
      }
      return artigo;
    }));
  } catch (erro) {
    if (empresa.value === idEmpresa) aviso.textContent = "Falha ao atualizar a cozinha. " + erro.message;
  } finally {
    carregando = false;
  }
}

document.getElementById("atualizar-cozinha").onclick = carregarCozinha;
setInterval(() => {
  if (!document.hidden && !document.getElementById("operacao").hidden) void carregarCozinha();
}, 5000);
