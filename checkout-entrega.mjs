import { criarLocationPicker } from "./location-picker.mjs";
import { executar } from "./supabase-pdv.mjs";

const moeda = valor => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor / 100);
const el = id => document.getElementById(id);
const escapar = texto => String(texto ?? "").replace(/[&<>"']/g, caractere => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[caractere]);
const etapas = ["Carrinho", "Localização", "Pagamento", "Contato", "Revisão"];

export async function iniciarCheckoutEntrega({ slug, menu, carrinho, aoConfirmar, aoPix }) {
  const form = el("pedido");
  const itens = el("itens-carrinho");
  const totalAntigo = el("total");
  const botao = el("enviar-pedido");
  form.replaceChildren();
  const progresso = document.createElement("div");
  progresso.className = "checkout-progresso";
  const conteudo = document.createElement("section");
  conteudo.id = "checkout-conteudo";
  const erro = document.createElement("p");
  erro.id = "erro-pedido";
  erro.setAttribute("role", "alert");
  const voltar = document.createElement("button");
  voltar.type = "button";
  voltar.className = "checkout-voltar";
  voltar.textContent = "← Voltar";
  const passo = document.createElement("p");
  passo.id = "passo-pedido";
  passo.className = "passo";
  form.append(progresso, conteudo, itens, totalAntigo, voltar, passo, botao, erro);
  botao.type = "button";
  form.onsubmit = evento => evento.preventDefault();
  const estado = { etapa: 0, pino: null, frete: null, cotacaoPino: null, modalidade: null,
    metodo: null, nome: "", telefone: "", troco: "", endereco: {}, ocupado: false, tentativa: null };
  const [pagamentoNaEntrega, metodosOnline] = await Promise.all([
    executar("pagamento_na_entrega_disponivel", { p_slug: slug }).catch(() => false),
    executar("metodos_checkout_publico", { p_slug: slug }).catch(() => ({ pix: false, credito: false, debito: false }))
  ]);
  const picker = criarLocationPicker({
    centro: menu.mapa_centro,
    aoConfirmar(pino) {
      const mudou = estado.pino?.maps_url !== pino.maps_url;
      estado.pino = pino;
      if (mudou) { estado.frete = null; estado.cotacaoPino = null; }
      render();
    }
  });
  const subtotal = () => carrinho.total();
  const endereco = () => ({
    maps_url: estado.pino.maps_url, latitude: estado.pino.latitude, longitude: estado.pino.longitude,
    ...estado.endereco, telefone: estado.telefone.replace(/\D/g, ""),
    metodo_pagamento: ({ cash: "dinheiro", terminal: "maquininha", credit: "credito", pix: "pix" })[estado.metodo],
    troco_para_centavos: estado.metodo === "cash" && estado.troco ? Math.round(Number(estado.troco.replace(",", ".")) * 100) : null
  });
  const enderecoParaCotar = () => ({ maps_url: estado.pino.maps_url,
    latitude: estado.pino.latitude, longitude: estado.pino.longitude, ...estado.endereco });
  function aviso(texto) { erro.textContent = texto; erro.scrollIntoView({ block: "nearest" }); }
  async function cotar() {
    if (!estado.pino) { aviso("Marque e confirme primeiro a localização no mapa. O pino é obrigatório para calcular o frete."); return false; }
    const chave = estado.pino.maps_url;
    estado.ocupado = true;
    erro.textContent = "";
    botao.disabled = true;
    try {
      const resposta = await fetch("/api/cotar-frete", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_slug: slug, endereco: enderecoParaCotar() }) });
      const resultado = await resposta.json().catch(() => ({}));
      if (estado.pino.maps_url !== chave) return false;
      if (!resposta.ok || !Number.isSafeInteger(resultado.frete_centavos)) {
        estado.frete = null;
        estado.cotacaoPino = null;
        aviso(resultado.erro || "Não foi possível calcular a entrega para este local.");
        return false;
      }
      estado.frete = resultado.frete_centavos;
      estado.cotacaoPino = chave;
      render();
      return true;
    } catch {
      aviso("Não foi possível calcular o frete agora. Tente novamente.");
      return false;
    } finally { estado.ocupado = false; botao.disabled = !carrinho.itens().length; }
  }
  const resumo = () => `<div class="checkout-resumo"><div><span>Subtotal</span><b>${moeda(subtotal())}</b></div><div><span>Entrega</span><b>${estado.frete === null ? "A calcular" : moeda(estado.frete)}</b></div><div class="checkout-total"><span>Total</span><b>${estado.frete === null ? "A calcular" : moeda(subtotal() + estado.frete)}</b></div></div>`;
  const campo = (nome, titulo, valor, extra = "") => `<label class="checkout-campo">${titulo}<input name="${nome}" value="${escapar(valor)}" ${extra}></label>`;
  function render() {
    progresso.innerHTML = etapas.map((nome, indice) => `<span class="${indice === estado.etapa ? "atual" : indice < estado.etapa ? "concluida" : ""}">${indice + 1} · ${nome}</span>`).join("");
    itens.hidden = estado.etapa !== 0;
    totalAntigo.hidden = true;
    voltar.hidden = estado.etapa === 0;
    passo.textContent = `Etapa ${estado.etapa + 1} de 5`;
    botao.textContent = ["Continuar para entrega", estado.frete === null ? "Calcular taxa de entrega" : "Continuar para pagamento",
      "Continuar para contato", "Revisar meu pedido", "Confirmar pedido"][estado.etapa];
    if (estado.etapa === 0) conteudo.innerHTML = `<small class="checkout-etiqueta">Carrinho · 01</small><h2>Seu pedido</h2><p>Confira os produtos e as quantidades. Você não precisa se cadastrar para pedir.</p><div class="checkout-resumo"><div><span>Subtotal</span><b>${moeda(subtotal())}</b></div></div>`;
    if (estado.etapa === 1) conteudo.innerHTML = `<small class="checkout-etiqueta">Localização · 02</small><h2>Onde vamos entregar?</h2><p>Marque seu local exato no mapa. A REMO devolve o frete antes do pagamento.</p><div class="checkout-localizacao"><strong>Localização no mapa <small>OBRIGATÓRIO</small></strong><button type="button" id="abrir-mapa" class="checkout-abrir-mapa">${estado.pino ? "Alterar localização" : "Marcar minha localização no mapa"} →</button><p>${estado.pino ? `Pino confirmado · ${estado.pino.latitude.toFixed(6)}, ${estado.pino.longitude.toFixed(6)}` : "Aguardando marcação no mapa"}</p>${estado.pino ? `<a target="_blank" rel="noopener noreferrer" href="${escapar(estado.pino.maps_url)}">Ver pino no Google Maps ↗</a>` : ""}</div><details id="endereco-opcional"><summary>Informações para o entregador <small>opcional</small></summary><p>Rua, número, bairro e referência são complementos. Não substituem o pino.</p>${campo("logradouro", "Rua ou avenida", estado.endereco.logradouro || "", 'maxlength="150"')}${campo("numero", "Número", estado.endereco.numero || "", 'maxlength="20"')}${campo("bairro", "Bairro", estado.endereco.bairro || "", 'maxlength="100"')}${campo("cidade", "Cidade", estado.endereco.cidade || "", 'maxlength="100"')}${campo("complemento", "Complemento / referência", estado.endereco.complemento || "", 'maxlength="150"')}</details>${resumo()}`;
    if (estado.etapa === 2) conteudo.innerHTML = `<small class="checkout-etiqueta">Pagamento · 03</small><h2>Como deseja pagar?</h2><p>Primeiro escolha a modalidade. Em seguida, selecione uma opção.</p>${metodosOnline.pix || metodosOnline.credito ? `<button type="button" class="checkout-modalidade ${estado.modalidade === "online" ? "selecionada" : ""}" data-modalidade="online"><strong>Pagar online</strong><small>Pix ou cartão online</small> →</button>` : ""}${pagamentoNaEntrega ? `<button type="button" class="checkout-modalidade ${estado.modalidade === "na_entrega" ? "selecionada" : ""}" data-modalidade="na_entrega"><strong>Pagar na entrega</strong><small>Dinheiro ou cartão na maquininha</small> →</button>` : ""}${estado.metodo ? `<div class="checkout-selecao">${{ pix: "Pix", credit: "Cartão de crédito", cash: "Dinheiro", terminal: "Cartão na maquininha" }[estado.metodo]} <button type="button" data-modalidade="${estado.modalidade}">Alterar</button></div>` : ""}${estado.metodo === "cash" ? campo("troco", "Troco para quanto? (opcional)", estado.troco, 'inputmode="decimal"') : ""}<p>Retirada no estabelecimento não está disponível neste fluxo de entrega.</p>${resumo()}`;
    if (estado.etapa === 3) conteudo.innerHTML = `<small class="checkout-etiqueta">Identificação · 04</small><h2>Como podemos falar com você?</h2><p>Precisamos somente dos dados para identificar a entrega e entrar em contato se necessário.</p>${campo("nome", "Seu nome", estado.nome, 'maxlength="100" autocomplete="name"')}${campo("telefone", "Celular com DDD", estado.telefone, 'type="tel" inputmode="tel" maxlength="17" autocomplete="tel"')}<p>Sem criar conta. Esses dados se vinculam ao pedido.</p>`;
    if (estado.etapa === 4) {
      const instrucao = [estado.endereco.logradouro, estado.endereco.numero, estado.endereco.bairro,
        estado.endereco.cidade, estado.endereco.complemento].filter(Boolean).map(escapar).join(", ");
      const linhas = carrinho.itens().map(item => {
        const produto = menu.produtos.find(p => p.id === item.produto_id);
        return `<p>${item.quantidade}× ${escapar(produto?.nome)} · ${moeda((produto?.preco_centavos || 0) * item.quantidade)}</p>`;
      }).join("");
      conteudo.innerHTML = `<small class="checkout-etiqueta">Conferência · 05</small><h2>Confira antes de confirmar</h2><p>A localização e o frete serão verificados de novo no servidor.</p><div class="checkout-revisao"><strong>Localização da entrega</strong><button type="button" data-etapa="1">Editar</button><p>Pino: ${estado.pino.latitude.toFixed(6)}, ${estado.pino.longitude.toFixed(6)}</p><a target="_blank" rel="noopener noreferrer" href="${escapar(estado.pino.maps_url)}">Abrir localização no Google Maps ↗</a>${instrucao ? `<p>${instrucao}</p>` : ""}</div><div class="checkout-revisao"><strong>Pagamento</strong><button type="button" data-etapa="2">Editar</button><p>${estado.modalidade === "online" ? "Pagar online" : "Pagar na entrega"} · ${{ pix: "Pix", credit: "Cartão de crédito", cash: "Dinheiro", terminal: "Cartão na maquininha" }[estado.metodo]}</p>${estado.metodo === "cash" && estado.troco ? `<p>Troco para ${moeda(Math.round(Number(estado.troco.replace(",", ".")) * 100))}</p>` : ""}</div><div class="checkout-revisao"><strong>Contato</strong><button type="button" data-etapa="3">Editar</button><p>${escapar(estado.nome)} · ${escapar(estado.telefone)}</p></div><div class="checkout-revisao"><strong>Itens</strong><button type="button" data-etapa="0">Editar</button>${linhas}</div>${resumo()}`;
    }
  }
  const modal = document.createElement("dialog");
  modal.className = "checkout-metodos";
  modal.innerHTML = `<div><button type="button" data-fechar="true" aria-label="Fechar">×</button><h2>Forma de pagamento</h2><p>Selecione como deseja pagar.</p><div id="checkout-opcoes"></div></div>`;
  document.body.append(modal);
  modal.addEventListener("close", () => { if (!estado.metodo) { estado.modalidade = null; render(); } });
  const alertaFrete = document.createElement("dialog");
  alertaFrete.className = "checkout-metodos";
  alertaFrete.innerHTML = `<div><h2>O frete foi atualizado</h2><p>A REMO retornou uma nova taxa na revisão. Nenhuma cobrança foi criada.</p><div id="checkout-diferenca-frete"></div><button type="button" id="checkout-aceitar-frete" class="primario largura">Atualizar valor e revisar novamente</button></div>`;
  document.body.append(alertaFrete);
  function mostrarFreteAtualizado(novoFrete) {
    if (!Number.isSafeInteger(novoFrete) || novoFrete < 0) return aviso("Não foi possível confirmar o novo frete.");
    alertaFrete.querySelector("#checkout-diferenca-frete").innerHTML = `<div class="checkout-resumo"><div><span>Frete anterior</span><b>${moeda(estado.frete)}</b></div><div><span>Frete atualizado</span><b>${moeda(novoFrete)}</b></div><div class="checkout-total"><span>Novo total</span><b>${moeda(subtotal() + novoFrete)}</b></div></div>`;
    alertaFrete.querySelector("#checkout-aceitar-frete").onclick = () => {
      estado.frete = novoFrete;
      estado.cotacaoPino = estado.pino.maps_url;
      estado.tentativa = null;
      alertaFrete.close();
      render();
    };
    alertaFrete.showModal();
  }
  const abrirMetodos = modalidade => {
    estado.modalidade = modalidade;
    estado.metodo = null;
    const opcoes = modalidade === "online" ? [
      ...(metodosOnline.pix ? [["pix", "Pix", "Confirmação automática após aprovação"]] : []),
      ...(metodosOnline.credito ? [["credit", "Cartão de crédito", "Transação pelo provedor"]] : []),
      ["debit", "Cartão de débito", "Previsto"]
    ] : [["cash", "Dinheiro", "Informar troco se necessário"], ["terminal", "Cartão na maquininha", "Crédito ou débito no recebimento"]];
    modal.querySelector("#checkout-opcoes").innerHTML = opcoes.map(([valor, nome, detalhe]) => `<button type="button" data-metodo="${valor}" ${valor === "debit" ? "disabled" : ""}><strong>${nome}</strong><small>${detalhe}</small></button>`).join("");
    modal.showModal();
  };
  modal.addEventListener("click", evento => {
    if (evento.target.closest("[data-fechar]")) modal.close();
    const metodo = evento.target.closest("[data-metodo]")?.dataset.metodo;
    if (metodo) { estado.metodo = metodo; modal.close(); render(); }
  });
  conteudo.addEventListener("click", evento => {
    if (evento.target.closest("#abrir-mapa")) picker.abrir();
    const modalidade = evento.target.closest("[data-modalidade]")?.dataset.modalidade;
    if (modalidade) abrirMetodos(modalidade);
    const etapa = evento.target.closest("[data-etapa]")?.dataset.etapa;
    if (etapa) { estado.etapa = Number(etapa); render(); }
  });
  conteudo.addEventListener("input", evento => {
    const { name, value } = evento.target;
    if (["logradouro", "numero", "bairro", "cidade", "complemento"].includes(name)) estado.endereco[name] = value.trim();
    if (name === "nome") estado.nome = value;
    if (name === "telefone") estado.telefone = value;
    if (name === "troco") estado.troco = value;
  });
  voltar.onclick = () => { erro.textContent = ""; estado.etapa = Math.max(0, estado.etapa - 1); render(); };
  botao.onclick = async () => {
    if (estado.ocupado) return;
    erro.textContent = "";
    if (estado.etapa === 0) { if (!carrinho.itens().length) return aviso("Adicione ao menos um produto."); estado.etapa++; render(); return; }
    if (estado.etapa === 1) {
      if (!estado.pino || estado.cotacaoPino !== estado.pino.maps_url || estado.frete === null) return void await cotar();
      estado.etapa++; render(); return;
    }
    if (estado.etapa === 2) {
      if (!estado.metodo) return aviso("Escolha a modalidade e o meio de pagamento para continuar.");
      if (estado.metodo === "cash" && estado.troco && (!Number.isFinite(Number(estado.troco.replace(",", "."))) || Math.round(Number(estado.troco.replace(",", ".")) * 100) < subtotal() + estado.frete)) return aviso("O valor para troco deve ser igual ou superior ao total do pedido.");
      estado.etapa++; render(); return;
    }
    if (estado.etapa === 3) {
      if (estado.nome.trim().length < 2) return aviso("Informe seu nome para identificação do pedido.");
      if (!/^\d{10,11}$/.test(estado.telefone.replace(/\D/g, ""))) return aviso("Informe um telefone válido com DDD (10 ou 11 dígitos).");
      estado.etapa++; render(); return;
    }
    estado.ocupado = true;
    botao.disabled = true;
    try {
      const chave = estado.pino.maps_url;
      const cotacaoAnterior = estado.frete;
      const respostaCotacao = await fetch("/api/cotar-frete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_slug: slug, endereco: enderecoParaCotar() }) });
      const novaCotacao = await respostaCotacao.json().catch(() => ({}));
      if (!respostaCotacao.ok) throw new Error(novaCotacao.erro || "Não foi possível confirmar o frete.");
      if (estado.pino.maps_url !== chave) throw new Error("A localização mudou. Confira o pedido novamente.");
      if (novaCotacao.frete_centavos !== cotacaoAnterior) return mostrarFreteAtualizado(novaCotacao.frete_centavos);
      const dados = { p_slug: slug, p_itens: carrinho.itens(),
        p_cliente: estado.nome.trim(), endereco: endereco(), pagamento: estado.modalidade,
        frete_centavos: estado.frete };
      const assinatura = JSON.stringify(dados);
      if (estado.tentativa?.assinatura !== assinatura) estado.tentativa = { id: crypto.randomUUID(), assinatura };
      dados.p_id = estado.tentativa.id;
      if (estado.metodo === "pix") { await aoPix(dados); await aoConfirmar(dados.p_id, "pix"); }
      else if (estado.modalidade === "na_entrega") {
        const resposta = await fetch("/api/checkout-pix-mercado-pago-quiosque", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
        const resultado = await resposta.json().catch(() => ({}));
        if (resposta.status === 409 && Number.isSafeInteger(resultado.frete_centavos)) return mostrarFreteAtualizado(resultado.frete_centavos);
        if (!resposta.ok) throw new Error(resultado.erro || "Não foi possível registrar o pedido.");
        await aoConfirmar(resultado.pedido, "na_entrega");
      } else if (estado.metodo === "credit") {
        const { abrirCreditoTeste } = await import("./credito-teste.mjs");
        el("carrinho-cardapio").close();
        el("vitrine").hidden = true;
        el("barra-cardapio").hidden = true;
        await abrirCreditoTeste({ totalCentavos: subtotal() + estado.frete,
          pedido: { ...dados }, aoFreteAlterado(novoFrete) {
            el("painel-credito-teste").hidden = true;
            estado.etapa = 4;
            render();
            el("carrinho-cardapio").showModal();
            mostrarFreteAtualizado(novoFrete);
          } }, id => aoConfirmar(id, "credito"), true);
      } else throw new Error("Escolha um método de pagamento disponível.");
    } catch (falha) {
      if (Number.isSafeInteger(falha.frete_centavos)) mostrarFreteAtualizado(falha.frete_centavos);
      else aviso(falha.message);
    }
    finally { estado.ocupado = false; botao.disabled = !carrinho.itens().length; }
  };
  el("pedido").hidden = false;
  el("vitrine").hidden = false;
  el("barra-cardapio").hidden = false;
  new MutationObserver(() => { if (estado.etapa === 0) render(); }).observe(itens, { childList: true, subtree: true, characterData: true });
  render();
}
