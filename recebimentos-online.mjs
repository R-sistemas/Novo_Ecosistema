import { paraReais } from "./pdv/regras/moeda.mjs";
import { listarRecebimentosOnline } from "./pdv/dados/caixa.mjs";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataLocal = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

export function configurarRecebimentosOnline(empresaAtual) {
  const resumo = document.getElementById("resumo-online");
  const lista = document.getElementById("recebimentos-online");
  const botao = document.getElementById("atualizar-online");
  const data = document.getElementById("data-online");
  data.value = dataLocal();
  const meios = { pix: "Pix", credito: "Crédito", debito: "Débito" };
  async function carregar() {
    const empresa = empresaAtual();
    if (!empresa) return;
    botao.disabled = true;
    try {
      const dia = data.value;
      const dados = await listarRecebimentosOnline(empresa, dia);
      if (empresa !== empresaAtual() || dia !== data.value) return;
      resumo.textContent = `${dados.quantidade} pedido(s) pago(s) online nesta data · ${moeda.format(paraReais(dados.total_centavos))} recebido(s), incluindo ${moeda.format(paraReais(dados.frete_centavos))} de taxa de entrega. Não altera o dinheiro esperado neste caixa.`;
      lista.replaceChildren(...dados.pedidos.map(pedido => {
        const linha = document.createElement("li");
        const horario = new Date(pedido.confirmado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const estado = pedido.estado_entrega || pedido.estado;
        linha.textContent = `Pedido ${pedido.comanda} · ${meios[pedido.meio] || pedido.meio} · ${moeda.format(paraReais(pedido.valor_centavos))} · ${horario} · ${estado}`;
        return linha;
      }));
      if (!dados.pedidos.length) lista.textContent = "Nenhum pagamento online confirmado hoje.";
    } catch (erro) {
      if (empresa === empresaAtual()) {
        resumo.textContent = "Não foi possível carregar os pagamentos online. " + erro.message;
        lista.replaceChildren();
      }
    } finally {
      botao.disabled = false;
    }
  }
  botao.onclick = carregar;
  data.onchange = carregar;
  return carregar;
}
