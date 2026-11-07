import { executar } from "./supabase-pdv.mjs";
import { aplicarTema } from "./tema-cardapio.mjs";
import { montarVitrine } from "./vitrine-cardapio.mjs";
import { estadosEntrega } from "./estado-entrega.mjs";

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
let acompanhamentoAtivo = false;
const pixTeste = p_slug === "loja-teste";
const creditoTeste = pixTeste && parametros.get("cartao") === "credito";
const entregaTeste = pixTeste && !p_mesa && !creditoTeste && parametros.get("entrega") === "teste";
const entregaQuiosque = p_slug === "quiosque-dorafa" && !p_mesa && parametros.get("entrega") === "sim";
const entrega = entregaTeste || entregaQuiosque;
const creditoQuiosque = !entrega && p_slug === "quiosque-dorafa" && parametros.get("cartao") === "credito";
const pixMercadoPagoTeste = entregaTeste || (pixTeste && parametros.get("pix") === "mercado-pago");
const pixMercadoPagoQuiosque = p_slug === "quiosque-dorafa" &&
  (entregaQuiosque || parametros.get("pix") === "mercado-pago" || (!p_id && !parametros.has("pix")));
let pixDisponivel = pixTeste;

async function executarComFeedback(acao) {
  if (ocupado) return;
  ocupado = true;
  try {
    await acao();
  } catch (erro) {
    el(el("carrinho-cardapio").open ? "erro-pedido" : "mensagem").textContent = erro.message;
  } finally {
    ocupado = false;
  }
}

async function acompanhar() {
  const pedido = await executar("acompanhar_pedido", { p_slug, p_id });
  if (!pedido) throw new Error("Pedido indisponível.");
  aguardandoPix = (pedido.pix_sandbox || pedido.pix_producao) && !pedido.pix_confirmado;
  const entregaEncerrada = ["entregue", "cancelada"].includes(pedido.estado_remo);
  acompanhamentoAtivo = aguardandoPix || (!entregaEncerrada && !["entregue", "recusado"].includes(pedido.estado)) ||
    Boolean(pedido.mesa && !pedido.pago && pedido.estado !== "recusado");
  el("mensagem").textContent = (aguardandoPix ? (creditoTeste ? "Aguardando confirmação do crédito de teste"
    : creditoQuiosque ? "Aguardando confirmação do cartão"
    : pixTeste ? "Aguardando Pix Sandbox" : "Aguardando pagamento Pix") : pedido.cancelado ? "Comanda cancelada" :
      estadosEntrega[pedido.estado_remo] ?? estados[pedido.estado]) +
    (pedido.cancelado ? "" : " · " + moeda.format(pedido.total_centavos / 100));
  if (pedido.mesa) {
    el("mensagem").textContent += " · Mesa " + pedido.mesa + " · Comanda " + pedido.comanda +
      (pedido.pago ? " · Pago" : aguardandoPix || pedido.estado === "recusado" ? "" : " · Pagar no caixa");
  }
  if (!aguardandoPix) el("pagamento-pix").hidden = true;
  const arte = el("arte-agradecimento");
  arte.hidden = !arte.getAttribute("src") || aguardandoPix || pedido.estado === "recusado";
  return aguardandoPix;
}

async function mostrarPix(dados) {
  const rota = pixMercadoPagoTeste ? "/api/checkout-pix-mercado-pago-teste"
    : pixMercadoPagoQuiosque ? "/api/checkout-pix-mercado-pago-quiosque"
    : pixTeste ? "/api/checkout-pix-sandbox" : "/api/checkout-pix-quiosque";
  const resposta = await fetch(rota, {
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
  const menu = await executar("ver_cardapio", { p_slug });
  if (!menu) throw new Error("Cardápio indisponível.");
  el("loja").textContent = menu.nome;
  aplicarTema(document.documentElement, menu.cor, menu.fundo);
  const marca = el("marca-loja");
  marca.textContent = menu.nome.split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
  if (menu.logo) {
    const logo = document.createElement("img");
    logo.src = menu.logo;
    logo.alt = "";
    marca.replaceChildren(logo);
  }
  if (menu.agradecimento) el("arte-agradecimento").src = menu.agradecimento;
  if (p_mesa || entrega) {
    el("contexto-cardapio").textContent = p_mesa ? "Pedido na mesa" : "Entrega";
    el("contexto-cardapio").hidden = false;
  }
  if (p_id) {
    el("acompanhar").hidden = false;
    if (await acompanhar() && !creditoTeste && !creditoQuiosque) await mostrarPix({ p_slug, p_id, p_itens: [] });
    return;
  }
  if (!menu.produtos.length) throw new Error("Nenhum produto disponível.");
  const carrinho = montarVitrine(menu.produtos);
  if (p_slug === "quiosque-dorafa") {
    pixDisponivel = await executar("pix_online_disponivel", { p_slug }).catch(() => false);
  }
  el("opcao-pix").hidden = Boolean(p_mesa) || entrega || creditoTeste || creditoQuiosque || !pixDisponivel;
  if (entrega) {
    el("entrega-teste").hidden = false;
    el("entrega-teste").disabled = false;
    if (entregaQuiosque) {
      el("legenda-entrega").textContent = "Endereço da entrega";
      el("pagamento-entrega").options[0].textContent = "Pix Mercado Pago";
    }
    if (await executar("pagamento_na_entrega_disponivel", { p_slug }).catch(() => false)) {
      el("pagamento-entrega").add(new Option("Pagar na entrega", "na_entrega"));
    }
  }
  el("rotulo-pix").textContent = pixMercadoPagoTeste ? "Simular Pix Mercado Pago"
    : pixMercadoPagoQuiosque ? "Pagar com Pix Mercado Pago"
    : pixTeste ? "Pagar com Pix Sandbox" : "Pagar com Pix";
  const pagamentoMesa = p_mesa && !creditoTeste && !creditoQuiosque;
  const pixEscolhido = () => pagamentoMesa
    ? document.querySelector('input[name="pagamento-mesa"]:checked').value === "pix"
    : el("pix-sandbox").checked;
  el("pix-sandbox").onchange = () => {
    const solicitarDocumento = !pixTeste && !pixMercadoPagoQuiosque && pixEscolhido();
    el("dados-pix").hidden = !solicitarDocumento;
    el("documento-pix").required = solicitarDocumento;
  };
  if (pagamentoMesa) {
    el("pagamento-mesa").hidden = false;
    el("pagamento-mesa").disabled = false;
    el("opcao-pix-mesa").hidden = !pixDisponivel;
    el("pagamento-mesa").onchange = el("pix-sandbox").onchange;
  }
  if (entrega) {
    el("pagamento-entrega").onchange = el("pix-sandbox").onchange;
    el("pagamento-entrega").onchange();
  }
  el("pedido").hidden = false;
  el("vitrine").hidden = false;
  el("barra-cardapio").hidden = false;
  function fecharCompra() {
    el("carrinho-cardapio").close();
    el("vitrine").hidden = true;
    el("barra-cardapio").hidden = true;
    window.scrollTo(0, 0);
  }
  el("pedido").addEventListener("change", evento => {
    if (!evento.target.matches("fieldset input[type=radio], #pagamento-entrega, #pix-sandbox")) return;
    el("passo-pedido").textContent = "Próximo passo · Confirme seu pedido";
    el("enviar-pedido").classList.add("guiado");
  });
  el("pedido").onsubmit = evento => {
    evento.preventDefault();
    executarComFeedback(async () => {
      el("erro-pedido").textContent = "";
      const p_itens = carrinho.itens();
      if (!p_itens.length) throw new Error("Escolha pelo menos um produto.");
      const p_cliente = el("cliente").value.trim();
      if (creditoTeste || creditoQuiosque) {
        if (creditoQuiosque) {
          el("titulo-credito").textContent = "Cartão de crédito";
          el("aviso-credito").textContent = "Piloto do Quiosque Do’Rafa";
        }
        const totalCentavos = carrinho.total();
        const { abrirCreditoTeste } = await import("./credito-teste.mjs");
        await abrirCreditoTeste({
          totalCentavos, pedido: { p_slug, p_mesa, p_itens, p_cliente, p_id: crypto.randomUUID() }
        }, async id => {
          p_id = id;
          parametros.set("pedido", id);
          history.replaceState(null, "", "?" + parametros);
          el("acompanhar").hidden = false;
          await acompanhar();
        }, creditoQuiosque);
        el("pedido").hidden = true;
        fecharCompra();
        return;
      }
      const pagamento = entrega ? el("pagamento-entrega").value : undefined;
      const endereco = entrega ? Object.fromEntries(
        [...el("entrega-teste").querySelectorAll("input")].map(campo => [campo.name, campo.value.trim()])
      ) : undefined;
      const pix = entrega ? pagamento === "online" : pixDisponivel && pixEscolhido();
      const cpfCnpj = pix && !pixTeste ? el("documento-pix").value : undefined;
      const assinatura = JSON.stringify({ p_itens, p_cliente, pix, cpfCnpj, endereco, pagamento });
      if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
      el("pedido").inert = true;
      try {
        const dados = { p_slug, p_mesa, p_itens, p_cliente, p_id: tentativa.id };
        if (pix) {
          await mostrarPix({ ...dados, cpfCnpj, endereco, pagamento });
          if (pixMercadoPagoQuiosque) parametros.set("pix", "mercado-pago");
          el("documento-pix").value = "";
          p_id = tentativa.id;
        } else if (entrega) {
          const rota = entregaTeste ? "/api/checkout-pix-mercado-pago-teste" : "/api/checkout-pix-mercado-pago-quiosque";
          const resposta = await fetch(rota, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...dados, endereco, pagamento })
          });
          const resultado = await resposta.json();
          if (!resposta.ok) throw new Error(resultado.erro);
          p_id = resultado.pedido;
        } else {
          p_id = await executar("enviar_pedido", dados);
        }
        parametros.set("pedido", p_id);
        parametros.delete("mesa");
        history.replaceState(null, "", "?" + parametros);
        el("pedido").hidden = true;
        fecharCompra();
        el("acompanhar").hidden = false;
        await acompanhar();
      } finally {
        el("pedido").inert = false;
      }
    });
  };
});

setInterval(() => {
  if (p_id && acompanhamentoAtivo && !document.hidden) {
    void executarComFeedback(acompanhar);
  }
}, 5000);
