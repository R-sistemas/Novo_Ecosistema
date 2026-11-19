import { moeda } from "../regras/pedido.mjs";
const escapar = texto => String(texto ?? "").replace(/[&<>"']/g, caractere => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[caractere]);
const etapas = ["Entrega e contato", "Pagamento e confirmação"];

export function configurarApresentacao(ctx) {
  function aviso(texto) { ctx.erro.textContent = texto; ctx.erro.scrollIntoView({ block: "nearest" }); }
  const resumo = () => `<div class="checkout-resumo"><div><span>Subtotal</span><b>${moeda(ctx.subtotal())}</b></div><div><span>Taxa de entrega</span><b>${ctx.estado.frete === null ? "A calcular" : moeda(ctx.estado.frete)}</b></div><div class="checkout-total"><span>Total</span><b>${ctx.estado.frete === null ? "A calcular" : moeda(ctx.subtotal() + ctx.estado.frete)}</b></div></div>`;
  function atualizarResumo() {
    const atual = ctx.conteudo.querySelector(".checkout-resumo");
    if (atual) atual.outerHTML = ctx.resumo();
  }
  const campo = (nome, titulo, valor, extra = "") => `<label class="checkout-campo">${titulo}<input name="${nome}" value="${escapar(valor)}" ${extra}></label>`;
  function marcarCampo(nome, mensagem) {
    const entrada = ctx.conteudo.querySelector(`[name="${nome}"]`);
    if (!entrada) return ctx.aviso(mensagem);
    const rotulo = entrada.closest(".checkout-campo");
    rotulo.classList.add("checkout-campo-invalido");
    entrada.setAttribute("aria-invalid", "true");
    let ajuda = rotulo.querySelector(".checkout-campo-erro");
    if (!ajuda) {
      ajuda = document.createElement("small");
      ajuda.className = "checkout-campo-erro";
      rotulo.append(ajuda);
    }
    ajuda.textContent = mensagem;
    entrada.focus();
    entrada.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function marcarLocalizacao() {
    const local = ctx.conteudo.querySelector(".checkout-localizacao");
    local?.classList.add("checkout-localizacao-invalida");
    if (local) local.querySelector("p").textContent = "Marque o destino no mapa para continuar.";
    local?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const resumoItens = () => `<div class="checkout-itens-resumo"><strong>Itens do pedido</strong>${ctx.carrinho.itens().map(item => {
    const produto = ctx.menu.produtos.find(p => p.id === item.produto_id);
    return `<p>${item.quantidade}× ${escapar(produto?.nome)} <b>${moeda((produto?.preco_centavos || 0) * item.quantidade)}</b></p>`;
  }).join("")}</div>`;
  function render() {
    ctx.progresso.innerHTML = etapas.map((nome, indice) => `<span class="${indice === ctx.estado.etapa ? "atual" : indice < ctx.estado.etapa ? "concluida" : ""}">${indice + 1} · ${nome}</span>`).join("");
    ctx.itens.hidden = ctx.estado.etapa !== 0;
    ctx.totalAntigo.hidden = true;
    ctx.voltar.hidden = ctx.estado.etapa === 0;
    ctx.passo.textContent = `Etapa ${ctx.estado.etapa + 1} de 2`;
    ctx.botao.textContent = ["Continuar para pagamento", "Confirmar pedido"][ctx.estado.etapa];
    if (ctx.estado.etapa === 0) {
      ctx.conteudo.innerHTML = `<small class="checkout-etiqueta">Entrega e contato · 01</small><h2>Onde vamos entregar?</h2><p>Marque o destino no mapa. A taxa de entrega aparece automaticamente.</p><div id="checkout-mapa-aqui"></div><div class="checkout-localizacao"><p>${ctx.estado.pino ? "Destino selecionado." : "Toque no mapa para selecionar o destino."}</p></div><details id="endereco-opcional"><summary>Informações para o entregador <small>opcional</small></summary><p>Rua, número, bairro e referência complementam o pino.</p>${ctx.campo("logradouro", "Rua ou avenida", ctx.estado.endereco.logradouro || "", 'maxlength="150"')}${ctx.campo("numero", "Número", ctx.estado.endereco.numero || "", 'maxlength="20"')}${ctx.campo("bairro", "Bairro", ctx.estado.endereco.bairro || "", 'maxlength="100"')}${ctx.campo("cidade", "Cidade", ctx.estado.endereco.cidade || "", 'maxlength="100"')}${ctx.campo("complemento", "Complemento / referência", ctx.estado.endereco.complemento || "", 'maxlength="150"')}</details><h3>Contato</h3>${ctx.campo("nome", "Seu nome", ctx.estado.nome, 'maxlength="100" autocomplete="name"')}${ctx.campo("telefone", "Celular com DDD (aceita +55)", ctx.estado.telefone, 'type="tel" inputmode="tel" maxlength="25" autocomplete="tel" placeholder="+55 62 99999-9999"')}<label class="checkout-lembrar"><input type="checkbox" name="lembrar" ${ctx.estado.lembrar ? "checked" : ""}> Salvar contato e localização neste aparelho para próximos pedidos</label><p class="checkout-privacidade">Você pode pedir sem criar conta. Os dados salvos neste aparelho podem ser apagados desmarcando esta opção ao confirmar outro pedido.</p>${ctx.resumo()}`;
      ctx.picker.montar(ctx.conteudo.querySelector("#checkout-mapa-aqui"));
    }
    if (ctx.estado.etapa === 1) {
      const bandeiras = `<span class="checkout-bandeiras" aria-label="Bandeiras de cartão: Visa, Mastercard, Elo e American Express"><span class="bandeira bandeira-visa" aria-hidden="true">VISA</span><span class="bandeira bandeira-master" aria-hidden="true"><i></i><i></i></span><span class="bandeira bandeira-elo" aria-hidden="true">elo</span><span class="bandeira bandeira-amex" aria-hidden="true">AMEX</span></span>`;
      const opcao = (id, titulo, detalhe, habilitado = true, complemento = "") =>
        `<button type="button" class="checkout-opcao ${ctx.estado.metodo === id ? "selecionada" : ""}" data-metodo="${id}" aria-pressed="${ctx.estado.metodo === id}" ${habilitado ? "" : "disabled"}><strong>${titulo}</strong><small>${detalhe}</small>${complemento}</button>`;
      const destino = [ctx.estado.endereco.logradouro, ctx.estado.endereco.numero, ctx.estado.endereco.bairro,
      ctx.estado.endereco.cidade, ctx.estado.endereco.complemento].filter(Boolean).join(", ") ||
        `Pino: ${ctx.estado.pino.latitude.toFixed(6)}, ${ctx.estado.pino.longitude.toFixed(6)}`;
      ctx.conteudo.innerHTML = `<small class="checkout-etiqueta">Pagamento e confirmação · 02</small><h2>Como deseja pagar?</h2><p>Confira seus itens e o valor total. Ao confirmar, você verá o QR Code do Pix ou os campos do cartão, conforme sua escolha.</p><div class="checkout-grupo-pagamento"><h3>Pagar online</h3>${opcao("pix", "Pix", "Pague pelo QR Code", ctx.metodosOnline.pix)}${opcao("credit", "Cartão de crédito", "Pague com seu cartão", ctx.metodosOnline.credito, bandeiras)}</div><div class="checkout-grupo-pagamento"><h3>Pagar na entrega</h3>${opcao("cash", "Dinheiro", "Pague ao receber o pedido", ctx.pagamentoNaEntrega)}${opcao("terminal", "Cartão na maquininha", "Crédito ou débito na entrega", ctx.pagamentoNaEntrega)}</div>${ctx.estado.metodo === "cash" ? ctx.campo("troco", "Troco para quanto? (opcional)", ctx.estado.troco, 'inputmode="decimal"') : ""}<p>Retirada no estabelecimento não está disponível neste fluxo de entrega.</p><div class="checkout-destino-resumo"><strong>Entrega para ${escapar(ctx.estado.nome)}</strong><span>${escapar(destino)} · ${escapar(ctx.estado.telefone)}</span><button type="button" data-etapa="0">Alterar entrega ou contato</button></div>${ctx.resumoItens()}${ctx.resumo()}`;
    }
  }
  Object.assign(ctx, { aviso, resumo, atualizarResumo, campo, marcarCampo, marcarLocalizacao, resumoItens, render });
}
