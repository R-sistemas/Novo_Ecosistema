import { entrar, executar } from "./supabase-pdv.mjs";

const el = id => document.getElementById(id);
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const form = el("login-remo");
const acoes = {
  solicitada: [["aceita", "Aceitar"], ["cancelada", "Cancelar"]],
  aceita: [["em_rota", "Iniciar rota"], ["cancelada", "Cancelar"]],
  em_rota: [["entregue", "Concluir entrega"]]
};

async function atualizar() {
  const pedidos = await executar("fila_remo", {});
  el("fila-remo").replaceChildren(...pedidos.map(pedido => {
    const linha = document.createElement("li");
    const { logradouro, numero, bairro, cidade, complemento } = pedido.destino;
    const destino = [logradouro, numero, bairro, cidade, complemento].filter(Boolean).join(", ");
    const receber = pedido.cobrar_na_entrega_centavos
      ? " · Cobrar " + moeda.format(pedido.cobrar_na_entrega_centavos / 100) : "";
    linha.textContent = (pedido.ambiente === "sandbox" ? "Teste · " : "") + destino + receber + " · " + pedido.estado;
    for (const [estado, rotulo] of acoes[pedido.estado] ?? []) {
      const botao = document.createElement("button");
      botao.textContent = rotulo;
      botao.onclick = async () => {
        linha.inert = true;
        try {
          await executar("avancar_solicitacao_remo", { p_id: pedido.id, p_estado: estado });
          await atualizar();
        } catch (erro) {
          el("aviso-remo").textContent = erro.message;
        } finally {
          linha.inert = false;
        }
      };
      linha.append(" ", botao);
    }
    return linha;
  }));
  el("aviso-remo").textContent = pedidos.length ? "" : "Nenhum despacho pendente.";
}

form.onsubmit = async evento => {
  evento.preventDefault();
  const dados = new FormData(form);
  form.inert = true;
  try {
    await entrar(dados.get("email"), dados.get("senha"));
    await atualizar();
    form.reset();
    form.hidden = true;
    el("central-remo").hidden = false;
  } catch (erro) {
    el("aviso-remo").textContent = erro.message;
  } finally {
    form.inert = false;
  }
};
el("atualizar-remo").onclick = () => atualizar().catch(erro => {
  el("aviso-remo").textContent = erro.message;
});
