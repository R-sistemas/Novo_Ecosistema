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
let aguardandoPix = false;
const pixTeste = p_slug === "loja-teste";
let pixDisponivel = pixTeste;

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
  aguardandoPix = (pedido.pix_sandbox || pedido.pix_producao) && !pedido.pix_confirmado;
  el("mensagem").textContent = (aguardandoPix ? (pixTeste ? "Aguardando Pix Sandbox" : "Aguardando pagamento Pix") : estados[pedido.estado]) +
    " · " + moeda.format(pedido.total_centavos / 100);
  if (!aguardandoPix) el("pagamento-pix").hidden = true;
  return aguardandoPix;
}

async function mostrarPix(dados) {
  const resposta = await fetch(pixTeste ? "/api/checkout-pix-sandbox" : "/api/checkout-pix-quiosque", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados)
  });
  const pix = await resposta.json();
  if (resposta.ok && pix.aguardaConfirmacao) return;
  if (!resposta.ok || !pix.imagem || !pix.copiaECola) {
    throw new Error(pix.erro ?? "QR Code indisponível.");
  }
  el("qr-pix").src = "data:image/png;base64," + pix.imagem;
  el("titulo-pix").textContent = pixTeste ? "Pix Sandbox" : "Pix";
  el("pix-codigo").value = pix.copiaECola;
  el("pagamento-pix").hidden = false;
}

el("acompanhar").onclick = () => executarComFeedback(acompanhar);

executarComFeedback(async () => {
  if (!p_slug) throw new Error("Abra o link do cardápio do estabelecimento.");
  if (p_id) {
    el("acompanhar").hidden = false;
    if (await acompanhar()) await mostrarPix({ p_slug, p_id, p_itens: [] });
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
  if (p_slug === "quiosque-dorafa") {
    pixDisponivel = await executar("pix_online_disponivel", { p_slug }).catch(() => false);
  }
  el("opcao-pix").hidden = !pixDisponivel;
  el("rotulo-pix").textContent = pixTeste ? "Pagar com Pix Sandbox" : "Pagar com Pix";
  el("pix-sandbox").onchange = () => {
    const solicitarDocumento = !pixTeste && el("pix-sandbox").checked;
    el("dados-pix").hidden = !solicitarDocumento;
    el("documento-pix").required = solicitarDocumento;
  };
  el("pedido").onsubmit = evento => {
    evento.preventDefault();
    executarComFeedback(async () => {
      const p_itens = campos.filter(({ campo }) => campo.valueAsNumber > 0).map(({ produto, campo }) => ({
        produto_id: produto.id, quantidade: campo.valueAsNumber
      }));
      if (!p_itens.length) throw new Error("Escolha pelo menos um produto.");
      const p_cliente = el("cliente").value.trim();
      const pix = pixDisponivel && el("pix-sandbox").checked;
      const cpfCnpj = pix && !pixTeste ? el("documento-pix").value : undefined;
      const assinatura = JSON.stringify({ p_itens, p_cliente, pix, cpfCnpj });
      if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
      el("pedido").inert = true;
      try {
        const dados = { p_slug, p_mesa, p_itens, p_cliente, p_id: tentativa.id };
        if (pix) {
          await mostrarPix({ ...dados, cpfCnpj });
          el("documento-pix").value = "";
          p_id = tentativa.id;
        } else {
          p_id = await executar("enviar_pedido", dados);
        }
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

setInterval(() => {
  if (p_id && aguardandoPix && !document.hidden) {
    void executarComFeedback(acompanhar);
  }
}, 5000);
