import { executar } from "./supabase-pdv.mjs";
import { aplicarTema } from "./tema-cardapio.mjs";
import { montarVitrine } from "./vitrine-cardapio.mjs";
import { estadosEntrega } from "./estado-entrega.mjs";
import { iniciarCheckoutEntrega } from "./checkout-entrega.mjs";

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
let entrega = entregaTeste || entregaQuiosque;
let creditoQuiosque = !entrega && p_slug === "quiosque-dorafa" && parametros.get("cartao") === "credito";
const escolhaPublicaEntrega = p_slug === "quiosque-dorafa" && !p_mesa && !creditoTeste && !creditoQuiosque;
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
  const pixConfirmado = Boolean((pedido.pix_sandbox || pedido.pix_producao) && pedido.pix_confirmado);
  const painelConfirmacao = el("pix-confirmado");
  painelConfirmacao.hidden = !pixConfirmado;
  if (pixConfirmado && !painelConfirmacao.dataset.exibido) {
    painelConfirmacao.dataset.exibido = "true";
    painelConfirmacao.classList.remove("pix-confirmado-entrar");
    void painelConfirmacao.offsetWidth;
    painelConfirmacao.classList.add("pix-confirmado-entrar");
  }
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
    const erro = new Error(pix.erro ?? "QR Code indisponível.");
    if (resposta.status === 409 && Number.isSafeInteger(pix.frete_centavos)) erro.frete_centavos = pix.frete_centavos;
    throw erro;
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
  if (p_slug === "quiosque-dorafa" && !p_mesa) {
    el("carrinho-cardapio").classList.add("checkout-entrega");
    el("contexto-cardapio").textContent = "Entrega";
    el("contexto-cardapio").hidden = false;
    await iniciarCheckoutEntrega({
      slug: p_slug, menu, carrinho,
      aoPix: dados => mostrarPix(dados),
      async aoConfirmar(id, metodo) {
        p_id = id;
        parametros.set("pedido", id);
        parametros.set("entrega", "sim");
        if (metodo === "credito") {
          creditoQuiosque = true;
          parametros.set("cartao", "credito");
          parametros.delete("pix");
        } else if (metodo === "pix") {
          parametros.set("pix", "mercado-pago");
          parametros.delete("cartao");
        }
        history.replaceState(null, "", "?" + parametros);
        el("pedido").hidden = true;
        el("carrinho-cardapio").close();
        el("vitrine").hidden = true;
        el("barra-cardapio").hidden = true;
        el("acompanhar").hidden = false;
        window.scrollTo(0, 0);
        await acompanhar();
      }
    });
    return;
  }
  let formaPagamento = "caixa";
  let freteEntregaCentavos = null;
  let enderecoCotado = null;
  let temporizadorCotacao = null;
  let sequenciaCotacao = 0;
  const enderecoEntrega = () => Object.fromEntries(
    [...el("entrega-teste").querySelectorAll("input")].map(campo => [campo.name, campo.value.trim()])
  );
  const chaveEndereco = endereco => JSON.stringify(endereco);
  const atualizarTextoFrete = () => {
    const aviso = el("frete-cotacao");
    if (!aviso || freteEntregaCentavos === null) return;
    aviso.textContent = `Entrega ${moeda.format(freteEntregaCentavos / 100)} · Total com entrega ${moeda.format((carrinho.total() + freteEntregaCentavos) / 100)}`;
  };
  async function cotarFrete(endereco) {
    const chave = chaveEndereco(endereco);
    const sequencia = ++sequenciaCotacao;
    const aviso = el("frete-cotacao");
    aviso.textContent = "Calculando a entrega…";
    freteEntregaCentavos = null;
    enderecoCotado = null;
    const resposta = await fetch("/api/cotar-frete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug, endereco })
    });
    const resultado = await resposta.json().catch(() => ({}));
    if (sequencia !== sequenciaCotacao || chave !== chaveEndereco(enderecoEntrega())) return null;
    if (!resposta.ok || !Number.isSafeInteger(resultado.frete_centavos) || resultado.frete_centavos < 0) {
      aviso.textContent = resultado.erro || "Não foi possível calcular a entrega para este endereço.";
      throw new Error(resultado.erro || "Não foi possível calcular o frete.");
    }
    freteEntregaCentavos = resultado.frete_centavos;
    enderecoCotado = chave;
    atualizarTextoFrete();
    return freteEntregaCentavos;
  }
  function agendarCotacaoFrete() {
    clearTimeout(temporizadorCotacao);
    sequenciaCotacao++;
    freteEntregaCentavos = null;
    enderecoCotado = null;
    const endereco = enderecoEntrega();
    if (!["logradouro", "numero", "bairro", "cidade"].every(campo => endereco[campo])) {
      freteEntregaCentavos = null;
      enderecoCotado = null;
      el("frete-cotacao").textContent = "Informe rua, número, bairro e cidade para calcular a entrega.";
      return;
    }
    temporizadorCotacao = setTimeout(() => {
      void cotarFrete(endereco).catch(() => {});
    }, 700);
  }
  if (p_slug === "quiosque-dorafa") {
    pixDisponivel = await executar("pix_online_disponivel", { p_slug }).catch(() => false);
  }
  el("tipo-entrega").hidden = !escolhaPublicaEntrega || entrega;
  el("pagamento-padrao").hidden = Boolean(p_mesa) || entrega || creditoTeste || creditoQuiosque;
  el("opcao-pix").hidden = !pixDisponivel || creditoTeste || creditoQuiosque;
  el("opcao-pix").textContent = pixTeste ? "Pagar com Pix Sandbox"
    : pixMercadoPagoQuiosque ? "Pagar com Pix Mercado Pago" : "Pagar com Pix";
  const atualizarPagamento = () => {
    const solicitarDocumento = !pixTeste && !pixMercadoPagoQuiosque && formaPagamento === "pix";
    el("dados-pix").hidden = !solicitarDocumento;
    el("documento-pix").required = solicitarDocumento;
  };
  function selecionarPagamento(valor, grupo) {
    formaPagamento = valor;
    grupo.querySelectorAll("[data-pagamento]").forEach(botao => {
      const selecionado = botao.dataset.pagamento === valor;
      botao.classList.toggle("selecionada", selecionado);
      botao.setAttribute("aria-pressed", String(selecionado));
    });
    atualizarPagamento();
  }
  document.querySelectorAll("#pagamento-padrao [data-pagamento], #pagamento-mesa [data-pagamento]").forEach(botao => {
    botao.addEventListener("click", () => selecionarPagamento(botao.dataset.pagamento, botao.closest(".opcoes-escolha")));
  });
  document.querySelectorAll("#pagamento-entrega [data-pagamento]").forEach(botao => {
    botao.addEventListener("click", () => selecionarPagamento(botao.dataset.pagamento, el("pagamento-entrega")));
  });
  document.querySelectorAll("#tipo-entrega [data-recebimento]").forEach(botao => {
    botao.addEventListener("click", () => {
      const entregar = botao.dataset.recebimento === "entrega";
      document.querySelectorAll("#tipo-entrega [data-recebimento]").forEach(opcao => {
        const selecionada = opcao === botao;
        opcao.classList.toggle("selecionada", selecionada);
        opcao.setAttribute("aria-pressed", String(selecionada));
      });
      entrega = entregar;
      el("entrega-teste").hidden = !entregar;
      el("entrega-teste").disabled = !entregar;
      el("contexto-cardapio").textContent = entregar ? "Entrega" : "Retirada no local";
      el("contexto-cardapio").hidden = false;
      el("pagamento-padrao").hidden = entregar;
      if (entregar) {
        el("pagamento-entrega").querySelectorAll("[data-pagamento]").forEach(opcao => {
          const selecionada = opcao.dataset.pagamento === "online";
          opcao.classList.toggle("selecionada", selecionada);
          opcao.setAttribute("aria-pressed", String(selecionada));
        });
        formaPagamento = "online";
        agendarCotacaoFrete();
      } else {
        clearTimeout(temporizadorCotacao);
        sequenciaCotacao++;
        freteEntregaCentavos = null;
        enderecoCotado = null;
        selecionarPagamento("caixa", el("pagamento-padrao"));
      }
      atualizarPagamento();
    });
  });
  if (entrega || escolhaPublicaEntrega) {
    el("entrega-teste").hidden = false;
    el("entrega-teste").disabled = false;
    if (p_slug === "quiosque-dorafa") {
      el("legenda-entrega").textContent = "Endereço da entrega";
      el("pagamento-entrega").querySelector('[data-pagamento="online"]').textContent = entregaTeste
        ? "Pix Mercado Pago de teste" : "Pix Mercado Pago";
    }
    if (await executar("pagamento_na_entrega_disponivel", { p_slug }).catch(() => false)) {
      el("pagamento-entrega").insertAdjacentHTML("beforeend", '<button class="opcao-escolha" type="button" data-pagamento="na_entrega" aria-pressed="false">Pagar na entrega</button>');
      const botao = el("pagamento-entrega").lastElementChild;
      botao.addEventListener("click", () => selecionarPagamento(botao.dataset.pagamento, el("pagamento-entrega")));
    }
    el("entrega-teste").addEventListener("input", agendarCotacaoFrete);
    el("entrega-teste").addEventListener("change", agendarCotacaoFrete);
    new MutationObserver(atualizarTextoFrete).observe(el("total"), { childList: true, characterData: true, subtree: true });
    if (!entrega) {
      el("entrega-teste").hidden = true;
      el("entrega-teste").disabled = true;
    }
  }
  const pagamentoMesa = p_mesa && !creditoTeste && !creditoQuiosque;
  const pixEscolhido = () => formaPagamento === "pix";
  if (pagamentoMesa) {
    el("pagamento-mesa").hidden = false;
    el("pagamento-mesa").disabled = false;
    el("opcao-pix-mesa").hidden = !pixDisponivel;
    el("pagamento-padrao").hidden = true;
  }
  if (entrega) {
    el("pagamento-padrao").hidden = true;
    formaPagamento = "online";
    atualizarPagamento();
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
  el("pedido").addEventListener("click", evento => {
    if (!evento.target.closest("[data-pagamento], [data-recebimento]")) return;
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
      const pagamento = entrega ? formaPagamento : undefined;
      const endereco = entrega ? enderecoEntrega() : undefined;
      let frete_centavos;
      if (entrega) {
        const chave = chaveEndereco(endereco);
        if (enderecoCotado !== chave || freteEntregaCentavos === null) {
          const valorAtualizado = await cotarFrete(endereco);
          if (valorAtualizado === null) throw new Error("O endereço mudou durante o cálculo. Aguarde a cotação atualizada.");
          throw new Error("Frete calculado. Confira o valor acima e confirme o pedido novamente.");
        }
        frete_centavos = freteEntregaCentavos;
      }
      const pix = entrega ? pagamento === "online" : pixDisponivel && pixEscolhido();
      const cpfCnpj = pix && !pixTeste ? el("documento-pix").value : undefined;
      const assinatura = JSON.stringify({ p_itens, p_cliente, pix, cpfCnpj, endereco, pagamento, frete_centavos });
      if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
      el("pedido").inert = true;
      try {
        const dados = { p_slug, p_mesa, p_itens, p_cliente, p_id: tentativa.id };
        if (entrega) parametros.set("entrega", entregaTeste ? "teste" : "sim");
        else if (!entregaTeste && !entregaQuiosque) parametros.delete("entrega");
        if (pix) {
          await mostrarPix({ ...dados, cpfCnpj, endereco, pagamento, frete_centavos });
          if (pixMercadoPagoQuiosque) parametros.set("pix", "mercado-pago");
          el("documento-pix").value = "";
          p_id = tentativa.id;
        } else if (entrega) {
          const rota = entregaTeste ? "/api/checkout-pix-mercado-pago-teste" : "/api/checkout-pix-mercado-pago-quiosque";
          const resposta = await fetch(rota, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...dados, endereco, pagamento, frete_centavos })
          });
          const resultado = await resposta.json();
          if (resposta.status === 409 && Number.isSafeInteger(resultado.frete_centavos)) {
            freteEntregaCentavos = resultado.frete_centavos;
            enderecoCotado = chaveEndereco(endereco);
            atualizarTextoFrete();
          }
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
