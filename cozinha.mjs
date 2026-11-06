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
  if (!idEmpresa || carregando) return;
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
      titulo.textContent = pedido.cliente + " · " + (pedido.mesa ? "Mesa " + pedido.mesa : "Retirada");
      const resumo = document.createElement("p");
      resumo.textContent = pedido.itens.map(item => item.quantidade + " × " + item.nome).join(", ");
      const financeiro = document.createElement("p");
      financeiro.textContent = pedido.recebido ? "Recebimento registrado" :
        pedido.estado === "entregue" ? "Entregue · recebimento pendente" : "Recebimento pendente";
      artigo.append(titulo, resumo, financeiro);
      if (!pedido.recebido) {
        const receber = document.createElement("button");
        receber.textContent = "Registrar recebimento no caixa";
        receber.onclick = () => fila.dispatchEvent(new CustomEvent("receber-pedido", { detail: pedido.id }));
        artigo.append(receber);
      }
      for (const [destino, texto] of acoes[pedido.estado]) {
        if ((destino === "entregue" && !pedido.recebido) || (destino === "recusado" && pedido.recebido)) continue;
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
