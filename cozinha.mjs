import { executar, listar } from "./supabase-pdv.mjs";

const fila = document.getElementById("fila-cozinha");
const aviso = document.getElementById("aviso-cozinha");
const empresa = document.getElementById("empresa");
const acoes = {
  novo: [["preparo", "Iniciar preparo"], ["recusado", "Recusar"]],
  preparo: [["pronto", "Marcar pronto"]],
  pronto: [["entregue", "Marcar entregue"]]
};

export async function carregarCozinha() {
  const idEmpresa = empresa.value;
  fila.replaceChildren();
  try {
    const pedidos = await listar("pedidos_online?empresa_id=eq." + idEmpresa +
      "&estado=in.(novo,preparo,pronto)&order=criado_em.asc&limit=100");
    if (empresa.value !== idEmpresa) return;
    aviso.textContent = pedidos.length ? "" : "Nenhum pedido em andamento.";
    fila.replaceChildren(...pedidos.map(pedido => {
      const artigo = document.createElement("article");
      const titulo = document.createElement("h3");
      titulo.textContent = pedido.cliente + " · " + (pedido.mesa ? "Mesa " + pedido.mesa : "Retirada");
      const resumo = document.createElement("p");
      resumo.textContent = pedido.itens.map(item => item.quantidade + " × " + item.nome).join(", ");
      artigo.append(titulo, resumo);
      for (const [destino, texto] of acoes[pedido.estado]) {
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
    if (empresa.value === idEmpresa) aviso.textContent = erro.message;
  }
}

document.getElementById("atualizar-cozinha").onclick = carregarCozinha;
