import { criarLocationPicker } from "./location-picker.mjs";
import { executar } from "./supabase-pdv.mjs";

const moeda = valor => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor / 100);
const el = id => document.getElementById(id);
const escapar = texto => String(texto ?? "").replace(/[&<>"']/g, caractere => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[caractere]);
const etapas = ["Entrega e contato", "Pagamento", "Conferência"];
function telefoneNacional(valor) {
  let digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) digitos = digitos.slice(2);
  return /^\d{10,11}$/.test(digitos) ? digitos : null;
}

export async function iniciarCheckoutEntrega({ slug, menu, carrinho, aoConfirmar, aoPix }) {
  const chaveDados = `checkout-entrega:${slug}:dados`;
  let dadosSalvos = null;
  try {
    const anterior = JSON.parse(localStorage.getItem(chaveDados) || "null");
    if (anterior && typeof anterior.nome === "string" && typeof anterior.telefone === "string" &&
        Number.isFinite(anterior.pino?.latitude) && Number.isFinite(anterior.pino?.longitude)) dadosSalvos = anterior;
  } catch { /* O checkout também funciona sem armazenamento local. */ }
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
  form.append(progresso, itens, conteudo, totalAntigo, voltar, passo, botao, erro);
  botao.type = "button";
  form.onsubmit = evento => evento.preventDefault();
  const estado = { etapa: 0, pino: dadosSalvos?.pino || null, frete: null, cotacaoPino: null, modalidade: null,
    metodo: null, nome: dadosSalvos?.nome || "", telefone: dadosSalvos?.telefone || "", troco: "",
    endereco: dadosSalvos?.endereco || {}, lembrar: Boolean(dadosSalvos), ocupado: false, tentativa: null };
  const [pagamentoNaEntrega, metodosOnline] = await Promise.all([
    executar("pagamento_na_entrega_disponivel", { p_slug: slug }).catch(() => false),
    executar("metodos_checkout_publico", { p_slug: slug }).catch(() => ({ pix: false, credito: false, debito: false }))
  ]);
  const picker = criarLocationPicker({
    centro: menu.mapa_centro,
    inicial: estado.pino,
    aoSelecionar(pino) {
      estado.pino = pino;
      invalidarCotacao();
      const resumoLocal = conteudo.querySelector(".checkout-localizacao p");
      if (resumoLocal) resumoLocal.textContent = "Destino selecionado. A taxa será calculada automaticamente.";
      atualizarResumo();
      agendarCotacao();
    }
  });
  const subtotal = () => carrinho.total();
  function salvarDados() {
    try {
      if (estado.lembrar) localStorage.setItem(chaveDados, JSON.stringify({
        nome: estado.nome.trim(), telefone: estado.telefone.trim(), pino: estado.pino, endereco: estado.endereco
      }));
      else localStorage.removeItem(chaveDados);
    } catch { /* Armazenamento indisponível não impede o pedido. */ }
  }
  const endereco = () => ({
    maps_url: estado.pino.maps_url, latitude: estado.pino.latitude, longitude: estado.pino.longitude,
    ...estado.endereco, telefone: telefoneNacional(estado.telefone),
    metodo_pagamento: ({ cash: "dinheiro", terminal: "maquininha", credit: "credito", pix: "pix" })[estado.metodo],
    troco_para_centavos: estado.metodo === "cash" && estado.troco ? Math.round(Number(estado.troco.replace(",", ".")) * 100) : null
  });
  const enderecoParaCotar = () => ({ maps_url: estado.pino.maps_url,
    latitude: estado.pino.latitude, longitude: estado.pino.longitude, ...estado.endereco });
  function aviso(texto) { erro.textContent = texto; erro.scrollIntoView({ block: "nearest" }); }
  let cotacaoTimer = null, cotacaoAbort = null, cotacaoVersao = 0;
  function invalidarCotacao() {
    cotacaoVersao++;
    clearTimeout(cotacaoTimer);
    cotacaoTimer = null;
    cotacaoAbort?.abort();
    cotacaoAbort = null;
    estado.frete = null;
    estado.cotacaoPino = null;
    estado.ocupado = false;
    erro.textContent = "";
    botao.disabled = !carrinho.itens().length;
  }
  function agendarCotacao() {
    if (!estado.pino || !carrinho.itens().length) return;
    cotacaoTimer = setTimeout(() => { cotacaoTimer = null; void cotar(); }, 450);
  }
  async function cotar() {
    if (!estado.pino) { aviso("Marque o local da entrega no mapa para calcular o frete."); return false; }
    clearTimeout(cotacaoTimer);
    cotacaoTimer = null;
    cotacaoAbort?.abort();
    cotacaoAbort = new AbortController();
    const sinal = cotacaoAbort.signal;
    const versao = ++cotacaoVersao;
    const chave = estado.pino.maps_url;
    estado.ocupado = true;
    erro.textContent = "";
    botao.disabled = true;
    botao.textContent = "Calculando entrega…";
    try {
      const resposta = await fetch("/api/cotar-frete", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_slug: slug, endereco: enderecoParaCotar() }), signal: sinal });
      const resultado = await resposta.json().catch(() => ({}));
      if (versao !== cotacaoVersao || estado.pino?.maps_url !== chave) return false;
      if (!resposta.ok || !Number.isSafeInteger(resultado.frete_centavos)) {
        estado.frete = null;
        estado.cotacaoPino = null;
        atualizarResumo();
        aviso(resultado.erro || "Não foi possível calcular a entrega para este local.");
        return false;
      }
      estado.frete = resultado.frete_centavos;
      estado.cotacaoPino = chave;
      atualizarResumo();
      return true;
    } catch {
      if (versao !== cotacaoVersao || sinal.aborted) return false;
      aviso("Não foi possível calcular o frete agora. Tente novamente.");
      return false;
    } finally {
      if (versao === cotacaoVersao) {
        estado.ocupado = false;
        cotacaoAbort = null;
        botao.disabled = !carrinho.itens().length;
        botao.textContent = "Continuar para pagamento";
      }
    }
  }
  const resumo = () => `<div class="checkout-resumo"><div><span>Subtotal</span><b>${moeda(subtotal())}</b></div><div><span>Entrega</span><b>${estado.frete === null ? "A calcular" : moeda(estado.frete)}</b></div><div class="checkout-total"><span>Total</span><b>${estado.frete === null ? "A calcular" : moeda(subtotal() + estado.frete)}</b></div></div>`;
  function atualizarResumo() {
    const atual = conteudo.querySelector(".checkout-resumo");
    if (atual) atual.outerHTML = resumo();
  }
  const campo = (nome, titulo, valor, extra = "") => `<label class="checkout-campo">${titulo}<input name="${nome}" value="${escapar(valor)}" ${extra}></label>`;
  function render() {
    progresso.innerHTML = etapas.map((nome, indice) => `<span class="${indice === estado.etapa ? "atual" : indice < estado.etapa ? "concluida" : ""}">${indice + 1} · ${nome}</span>`).join("");
    itens.hidden = estado.etapa !== 0;
    totalAntigo.hidden = true;
    voltar.hidden = estado.etapa === 0;
    passo.textContent = `Etapa ${estado.etapa + 1} de 3`;
    botao.textContent = ["Continuar para pagamento", "Revisar meu pedido", "Confirmar pedido"][estado.etapa];
    if (estado.etapa === 0) {
      conteudo.innerHTML = `<small class="checkout-etiqueta">Entrega e contato · 01</small><h2>Onde vamos entregar?</h2><p>Marque o destino no mapa. A taxa de entrega aparece automaticamente.</p><div id="checkout-mapa-aqui"></div><div class="checkout-localizacao"><p>${estado.pino ? "Destino selecionado." : "Toque no mapa para selecionar o destino."}</p></div><details id="endereco-opcional"><summary>Informações para o entregador <small>opcional</small></summary><p>Rua, número, bairro e referência complementam o pino.</p>${campo("logradouro", "Rua ou avenida", estado.endereco.logradouro || "", 'maxlength="150"')}${campo("numero", "Número", estado.endereco.numero || "", 'maxlength="20"')}${campo("bairro", "Bairro", estado.endereco.bairro || "", 'maxlength="100"')}${campo("cidade", "Cidade", estado.endereco.cidade || "", 'maxlength="100"')}${campo("complemento", "Complemento / referência", estado.endereco.complemento || "", 'maxlength="150"')}</details><h3>Contato</h3>${campo("nome", "Seu nome", estado.nome, 'maxlength="100" autocomplete="name"')}${campo("telefone", "Celular com DDD (aceita +55)", estado.telefone, 'type="tel" inputmode="tel" maxlength="25" autocomplete="tel" placeholder="+55 62 99999-9999"')}<label class="checkout-lembrar"><input type="checkbox" name="lembrar" ${estado.lembrar ? "checked" : ""}> Salvar contato e localização neste aparelho para próximos pedidos</label><p class="checkout-privacidade">Você pode pedir sem criar conta. Os dados salvos neste aparelho podem ser apagados desmarcando esta opção ao confirmar outro pedido.</p>${resumo()}`;
      picker.montar(conteudo.querySelector("#checkout-mapa-aqui"));
    }
    if (estado.etapa === 1) {
      const bandeiras = `<span class="checkout-bandeiras" aria-label="Bandeiras de cartão: Visa, Mastercard, Elo e American Express"><span class="bandeira bandeira-visa" aria-hidden="true">VISA</span><span class="bandeira bandeira-master" aria-hidden="true"><i></i><i></i></span><span class="bandeira bandeira-elo" aria-hidden="true">elo</span><span class="bandeira bandeira-amex" aria-hidden="true">AMEX</span></span>`;
      const opcao = (id, titulo, detalhe, habilitado = true, complemento = "") =>
        `<button type="button" class="checkout-opcao ${estado.metodo === id ? "selecionada" : ""}" data-metodo="${id}" aria-pressed="${estado.metodo === id}" ${habilitado ? "" : "disabled"}><strong>${titulo}</strong><small>${detalhe}</small>${complemento}</button>`;
      conteudo.innerHTML = `<small class="checkout-etiqueta">Pagamento · 02</small><h2>Como deseja pagar?</h2><p>Selecione uma forma de pagamento. A escolha ficará visível antes da confirmação.</p><div class="checkout-grupo-pagamento"><h3>Pagar online</h3>${opcao("pix", "Pix", "Pague pelo QR Code", metodosOnline.pix)}${opcao("credit", "Cartão de crédito", "Pague com seu cartão", metodosOnline.credito, bandeiras)}${opcao("debit", "Cartão de débito", "Ainda não disponível", false)}</div><div class="checkout-grupo-pagamento"><h3>Pagar na entrega</h3>${opcao("cash", "Dinheiro", "Pague ao receber o pedido", pagamentoNaEntrega)}${opcao("terminal", "Cartão na maquininha", "Crédito ou débito na entrega", pagamentoNaEntrega)}</div>${estado.metodo === "cash" ? campo("troco", "Troco para quanto? (opcional)", estado.troco, 'inputmode="decimal"') : ""}<p>Retirada no estabelecimento não está disponível neste fluxo de entrega.</p>${resumo()}`;
    }
    if (estado.etapa === 2) {
      const instrucao = [estado.endereco.logradouro, estado.endereco.numero, estado.endereco.bairro,
        estado.endereco.cidade, estado.endereco.complemento].filter(Boolean).map(escapar).join(", ");
      const linhas = carrinho.itens().map(item => {
        const produto = menu.produtos.find(p => p.id === item.produto_id);
        return `<p>${item.quantidade}× ${escapar(produto?.nome)} · ${moeda((produto?.preco_centavos || 0) * item.quantidade)}</p>`;
      }).join("");
      conteudo.innerHTML = `<small class="checkout-etiqueta">Conferência · 03</small><h2>Confira antes de confirmar</h2><p>A localização e o frete serão verificados de novo no servidor.</p><div class="checkout-revisao"><strong>Localização e contato</strong><button type="button" data-etapa="0">Editar</button><p>Pino: ${estado.pino.latitude.toFixed(6)}, ${estado.pino.longitude.toFixed(6)}</p>${instrucao ? `<p>${instrucao}</p>` : ""}<p>${escapar(estado.nome)} · ${escapar(estado.telefone)}</p></div><div class="checkout-revisao"><strong>Pagamento</strong><button type="button" data-etapa="1">Editar</button><p>${estado.modalidade === "online" ? "Pagar online" : "Pagar na entrega"} · ${{ pix: "Pix", credit: "Cartão de crédito", cash: "Dinheiro", terminal: "Cartão na maquininha" }[estado.metodo]}</p>${estado.metodo === "cash" && estado.troco ? `<p>Troco para ${moeda(Math.round(Number(estado.troco.replace(",", ".")) * 100))}</p>` : ""}</div><div class="checkout-revisao"><strong>Itens</strong><button type="button" data-etapa="0">Editar</button>${linhas}</div>${resumo()}`;
    }
  }
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
  conteudo.addEventListener("click", evento => {
    const metodo = evento.target.closest("[data-metodo]")?.dataset.metodo;
    if (metodo) {
      estado.metodo = metodo;
      estado.modalidade = ["cash", "terminal"].includes(metodo) ? "na_entrega" : "online";
      render();
    }
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
  conteudo.addEventListener("change", evento => {
    if (evento.target.name === "lembrar") estado.lembrar = evento.target.checked;
  });
  voltar.onclick = () => { erro.textContent = ""; estado.etapa = Math.max(0, estado.etapa - 1); render(); };
  botao.onclick = async () => {
    if (estado.ocupado) return;
    erro.textContent = "";
    if (estado.etapa === 0) {
      if (!carrinho.itens().length) return aviso("Adicione ao menos um produto.");
      if (estado.nome.trim().length < 2) return aviso("Informe seu nome para identificação do pedido.");
      if (!telefoneNacional(estado.telefone)) return aviso("Informe um celular válido com DDD, com ou sem +55.");
      if (!estado.pino || estado.cotacaoPino !== estado.pino.maps_url || estado.frete === null) {
        if (!await cotar()) return;
      }
      estado.etapa = 1; render(); return;
    }
    if (estado.etapa === 1) {
      if (!estado.metodo) return aviso("Escolha a modalidade e o meio de pagamento para continuar.");
      if (estado.metodo === "cash" && estado.troco && (!Number.isFinite(Number(estado.troco.replace(",", "."))) || Math.round(Number(estado.troco.replace(",", ".")) * 100) < subtotal() + estado.frete)) return aviso("O valor para troco deve ser igual ou superior ao total do pedido.");
      estado.etapa++; render(); return;
    }
    estado.ocupado = true;
    botao.disabled = true;
    el("limpar-carrinho").disabled = true;
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
      if (estado.metodo === "pix") { await aoPix(dados); salvarDados(); await aoConfirmar(dados.p_id, "pix"); }
      else if (estado.modalidade === "na_entrega") {
        const resposta = await fetch("/api/checkout-pix-mercado-pago-quiosque", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
        const resultado = await resposta.json().catch(() => ({}));
        if (resposta.status === 409 && Number.isSafeInteger(resultado.frete_centavos)) return mostrarFreteAtualizado(resultado.frete_centavos);
        if (!resposta.ok) throw new Error(resultado.erro || "Não foi possível registrar o pedido.");
        salvarDados();
        await aoConfirmar(resultado.pedido, "na_entrega");
      } else if (estado.metodo === "credit") {
        const { abrirCreditoTeste } = await import("./credito-teste.mjs");
        el("carrinho-cardapio").close();
        el("vitrine").hidden = true;
        el("barra-cardapio").hidden = true;
        await abrirCreditoTeste({ totalCentavos: subtotal() + estado.frete,
          pedido: { ...dados }, aoFreteAlterado(novoFrete) {
            el("painel-credito-teste").hidden = true;
            estado.etapa = 2;
            render();
            el("carrinho-cardapio").showModal();
            mostrarFreteAtualizado(novoFrete);
          } }, id => { salvarDados(); return aoConfirmar(id, "credito"); }, true);
      } else throw new Error("Escolha um método de pagamento disponível.");
    } catch (falha) {
      if (Number.isSafeInteger(falha.frete_centavos)) mostrarFreteAtualizado(falha.frete_centavos);
      else aviso(falha.message);
    }
    finally { estado.ocupado = false; botao.disabled = !carrinho.itens().length; el("limpar-carrinho").disabled = false; }
  };
  el("pedido").hidden = false;
  el("vitrine").hidden = false;
  el("barra-cardapio").hidden = false;
  document.addEventListener("cardapio:carrinho-aberto", () => {
    render();
    if (estado.pino && estado.frete === null) agendarCotacao();
  });
  document.addEventListener("cardapio:carrinho-limpo", () => {
    invalidarCotacao();
    picker.limpar();
    estado.etapa = 0;
    estado.pino = dadosSalvos?.pino || null;
    estado.frete = null;
    estado.cotacaoPino = null;
    estado.modalidade = null;
    estado.metodo = null;
    estado.nome = dadosSalvos?.nome || "";
    estado.telefone = dadosSalvos?.telefone || "";
    estado.troco = "";
    estado.endereco = dadosSalvos?.endereco || {};
    estado.lembrar = Boolean(dadosSalvos);
    estado.tentativa = null;
    erro.textContent = "";
    conteudo.replaceChildren();
  });
  new MutationObserver(() => { if (estado.etapa === 0 && el("carrinho-cardapio").open) render(); }).observe(itens, { childList: true, subtree: true, characterData: true });
}
