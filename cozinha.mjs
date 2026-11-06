import { executar } from "./supabase-pdv.mjs";

const fila = document.getElementById("fila-cozinha");
const aviso = document.getElementById("aviso-cozinha");
const empresa = document.getElementById("empresa");
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
      titulo.textContent = pedido.cliente + " · " + modalidade;
      if (pedido.mesa) titulo.textContent += " · Comanda " + pedido.comanda;
      const resumo = document.createElement("p");
      resumo.textContent = pedido.itens.map(item => item.quantidade + " × " + item.nome).join(", ");
      const financeiro = document.createElement("p");
      financeiro.textContent = pedido.pix_teste ? "Pagamento confirmado no Sandbox" : pedido.recebido ? "Recebimento registrado" :
        pedido.pagamento_entrega === "na_entrega" ? "Pagamento na entrega pendente" :
        pedido.estado === "entregue" ? "Entregue · recebimento pendente" : "Recebimento pendente";
      artigo.append(titulo, resumo, financeiro);
      if (pedido.endereco_entrega) {
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
      if (!pedido.recebido && !pedido.mesa) {
        const receber = document.createElement("button");
        receber.textContent = "Registrar recebimento no caixa";
        receber.onclick = () => fila.dispatchEvent(new CustomEvent("receber-pedido", { detail: pedido.id }));
        artigo.append(receber);
      }
      for (const [destino, texto] of acoes[pedido.estado]) {
        if ((destino === "entregue" && !pedido.recebido && !pedido.mesa) || (destino === "recusado" && pedido.recebido)) continue;
        const botao = document.createElement("button");
        botao.textContent = texto;
        botao.onclick = async () => {
          artigo.inert = true;
          try {
            await executar("avancar_pedido", { p_id: pedido.id, p_estado: destino });
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
