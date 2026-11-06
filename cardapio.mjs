import { executar } from "./supabase-pdv.mjs";

const el = id => document.getElementById(id);
const parametros = new URLSearchParams(location.search);
const p_slug = parametros.get("loja");
const p_mesa = parametros.get("mesa");
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const estados = { novo: "Recebido", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue", recusado: "Recusado" };
let p_id = parametros.get("pedido");
let tentativa;
let ocupado = false;

async function executarComFeedback(acao) {
  if (ocupado) return;
  ocupado = true;
  try {
    await acao();
  } catch (erro) {
    el("mensagem").textContent = erro.message;
  } finally {
    ocupado = false;
  }
}

async function acompanhar() {
  const pedido = await executar("acompanhar_pedido", { p_slug, p_id });
  if (!pedido) throw new Error("Pedido indisponível.");
  el("mensagem").textContent = estados[pedido.estado] + " · " + moeda.format(pedido.total_centavos / 100);
}

el("acompanhar").onclick = () => executarComFeedback(acompanhar);

executarComFeedback(async () => {
  if (!p_slug) throw new Error("Abra o link do cardápio do estabelecimento.");
  if (p_id) {
    el("acompanhar").hidden = false;
    await acompanhar();
    return;
  }
  const menu = await executar("ver_cardapio", { p_slug });
  if (!menu) throw new Error("Cardápio indisponível.");
  el("loja").textContent = menu.nome;
  if (!menu.produtos.length) throw new Error("Nenhum produto disponível.");

  const campos = menu.produtos.map(produto => {
    const rotulo = document.createElement("label");
    const campo = document.createElement("input");
    campo.type = "number";
    campo.min = "0";
    campo.max = "100";
    campo.value = "0";
    rotulo.append(produto.nome + " · " + moeda.format(produto.preco_centavos / 100), campo);
    el("produtos").append(rotulo);
    return { produto, campo };
  });
  const totalizar = () => {
    const total = campos.reduce((soma, { produto, campo }) =>
      soma + produto.preco_centavos * (campo.valueAsNumber || 0), 0);
    el("total").textContent = "Total · " + moeda.format(total / 100);
  };
  el("pedido").addEventListener("input", totalizar);
  totalizar();
  el("pedido").hidden = false;
  el("pedido").onsubmit = evento => {
    evento.preventDefault();
    executarComFeedback(async () => {
      const p_itens = campos.filter(({ campo }) => campo.valueAsNumber > 0).map(({ produto, campo }) => ({
        produto_id: produto.id, quantidade: campo.valueAsNumber
      }));
      if (!p_itens.length) throw new Error("Escolha pelo menos um produto.");
      const p_cliente = el("cliente").value.trim();
      const assinatura = JSON.stringify({ p_itens, p_cliente });
      if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
      el("pedido").inert = true;
      try {
        p_id = await executar("enviar_pedido", { p_slug, p_mesa, p_itens, p_cliente, p_id: tentativa.id });
        parametros.set("pedido", p_id);
        parametros.delete("mesa");
        history.replaceState(null, "", "?" + parametros);
        el("pedido").hidden = true;
        el("acompanhar").hidden = false;
        await acompanhar();
      } finally {
        el("pedido").inert = false;
      }
    });
  };
});
