import { saldo } from "./caixa.mjs";
import { entrar, listar, executar, cadastrarOperador, cadastrarProduto, atualizarProduto } from "./supabase-pdv.mjs";
import { carregarCozinha } from "./cozinha.mjs";
import { carregarAjustesCaixa } from "./ajustes-caixa.mjs";
import { aplicarTema } from "./tema-cardapio.mjs";
import { otimizarImagem } from "./imagens-cardapio.mjs";
import { abrirAdmin, modalAdminAtivo } from "./administracao.mjs";
import { configurarPesagem, detalhePesagem } from "./pesagem.mjs";
import { configurarCancelamentos } from "./cancelar-comanda.mjs";
import { configurarPixPdv } from "./pix-pdv.mjs";

let produtos = [];
let usuario;
let empresasGerenciadas = new Set();
let ocupado = false;
let vendaPendente;
let meioSelecionado;
let area;
let terminais = [];
let produtoEditado;
let catalogoAdmin = [];
let aparencia;
let consultaComandas = 0;
let ultimaListaComandas;
let comandaAberta;
let adicionalPendente;
let ambientePixFrente;
const estado = { sessao: null, fechamentos: [] };
const carrinho = new Map();
const meios = { Dinheiro: "dinheiro", Pix: "pix", "Cartão": "cartao" };
const el = id => document.getElementById(id);
const dialogoPesagem = el("dialogo-pesagem");
const pesagem = configurarPesagem(el("campos-pesagem"));
let itemPesagem;
let tentativaPesagem;
const opcoesPagamento = [...document.querySelectorAll("[data-meio-pdv]")];
const reais = centavos => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL"
}).format(centavos / 100);
const pixFrente = configurarPixPdv({
  caixa: () => estado.sessao?.id,
  atualizar: (ativo, resultado) => {
    if (ativo) {
      abrirPagamento();
      meioSelecionado = "Pix";
      el("titulo-pagamento-frente").textContent = "Pix automático";
      el("orientacao-frente").textContent = "A venda será registrada quando o Mercado Pago confirmar.";
      el("dinheiro-frente").hidden = true;
      el("detalhe-pagamento-frente").hidden = false;
    }
    if (resultado?.itens && !resultado.pedido && !carrinho.size) {
      for (const item of resultado.itens) {
        const produto = produtos.find(p => p.id === item.produto_id);
        if (produto) carrinho.set(produto.codigo, item.quantidade);
      }
      if (resultado.desconto) el("valor-desconto").value = resultado.desconto / 100;
    }
    renderizar();
  },
  recebido: async resultado => {
    comandaAberta = undefined;
    carrinho.clear();
    limparPagamento();
    renderizar();
    el("notice").textContent = "Pix confirmado · " + reais(resultado.valor);
    await atualizar();
    void carregarComandas();
    void carregarCozinha();
  }
});
const precoAdicional = produto => comandaAberta?.itens.find(i => i.produto_id === produto.id && !i.pesagem)?.preco_centavos ?? produto.preco;
const subtotal = () => pixFrente.atual()?.itens ? pixFrente.atual().valor + pixFrente.atual().desconto : (comandaAberta?.total_centavos ?? 0) + produtos.reduce((soma, produto) =>
  soma + precoAdicional(produto) * (carrinho.get(produto.codigo) ?? 0), 0);
const desconto = () => !comandaAberta && empresasGerenciadas.has(el("empresa").value)
  ? Math.round((el("valor-desconto").valueAsNumber || 0) * 100) : 0;
const total = () => pixFrente.atual()?.valor ?? subtotal() - desconto();
const temItens = () => Boolean(comandaAberta || carrinho.size || pixFrente.atual());

function botao(texto, acao, secundario = false) {
  const elemento = document.createElement("button");
  elemento.type = "button";
  elemento.textContent = texto;
  elemento.classList.toggle("secondary", secundario);
  elemento.addEventListener("click", acao);
  return elemento;
}

async function atualizar() {
  const empresa = el("empresa").value;
  const administracao = area === "administracao";
  const terminalAnterior = el("terminal-pdv").value;
  el("configuracao-entrega").hidden = true;
  const [catalogo, caixas, configuracao, caixasDisponiveis, pixDisponivel] = await Promise.all([
    listar("produtos?ativo=eq.true&empresa_id=eq." + empresa + "&order=nome" +
      (administracao ? "" : "&select=id,codigo,nome,preco_centavos,categoria,vendido_por_peso")),
    administracao ? [] : listar("caixas?empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=aberto_em.desc&limit=1"),
    listar("empresas?select=nome,nome_pdv,pagamento_na_entrega" +
      (administracao ? ",cardapio_cor,cardapio_fundo,cardapio_logo,cardapio_agradecimento" : "") + "&id=eq." + empresa),
    administracao ? executar("listar_terminais_gestor", { p_empresa: empresa })
      : listar("terminais_pdv?select=id,nome&empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=nome"),
    administracao ? null : executar("pix_frente_disponivel", { p_empresa: empresa })
  ]);
  const nomePdv = configuracao[0].nome_pdv ?? configuracao[0].nome;
  el("nome-pdv-exibido").textContent = nomePdv;
  terminais = caixasDisponiveis;
  ambientePixFrente = pixDisponivel;
  if (administracao) {
    const config = configuracao[0];
    el("admin-nome-loja").textContent = config.nome;
    aparencia = { logo: config.cardapio_logo, agradecimento: config.cardapio_agradecimento };
    el("aparencia-cardapio").reset();
    el("cor-cardapio").value = config.cardapio_cor;
    el("fundo-cardapio").value = config.cardapio_fundo;
    el("previa-nome").textContent = config.nome;
    previaAparencia();
    el("status").textContent = "Administração";
    el("nome-pdv").value = nomePdv;
    el("editar-terminal").replaceChildren(new Option("Novo caixa", ""),
      ...terminais.map(t => new Option(t.nome + " · " + (t.email ?? "Sem operador ativo"), t.id)));
    el("configurar-terminal").reset();
    el("cadastro-produto").hidden = false;
    el("pagamento-na-entrega").checked = configuracao[0].pagamento_na_entrega;
    el("configuracao-entrega").hidden = false;
    catalogoAdmin = catalogo;
    renderizarCatalogoAdmin();
    return;
  }
  const caixa = caixas[0];
  el("terminal-pdv").replaceChildren(...terminais.map(t => new Option(t.nome, t.id)));
  if (caixa && !caixa.fechado_em && !terminais.some(t => t.id === caixa.terminal_id)) {
    el("terminal-pdv").add(new Option("Caixa do turno atual", caixa.terminal_id ?? ""));
  }
  el("terminal-pdv").value = caixa && !caixa.fechado_em ? caixa.terminal_id ?? ""
    : terminais.some(t => t.id === terminalAnterior) ? terminalAnterior : terminais[0]?.id ?? "";
  const registros = caixa ? await listar("movimentos_caixa?caixa_id=eq." + caixa.id + "&order=criado_em.asc") : [];
  produtos = catalogo.map(p => ({ ...p, preco: Number(p.preco_centavos) }));
  const movimentos = registros.map(m => ({
    tipo: m.tipo, meio: m.meio, valor: Number(m.valor_centavos),
    centavos: m.meio !== "dinheiro" ? 0 : Number(m.valor_centavos) * (m.tipo === "sangria" ? -1 : 1)
  }));
  const sessao = caixa && { id: caixa.id, abertura: Number(caixa.abertura_centavos), movimentos };
  estado.sessao = caixa && !caixa.fechado_em ? sessao : null;
  estado.fechamentos = caixa?.fechado_em ? [{
    esperado: saldo(sessao), contado: Number(caixa.contado_centavos), movimentos
  }] : [];
  renderizar();
  if (estado.sessao) await pixFrente.recuperar().catch(erro => { el("notice").textContent = erro.message; });
}

async function operar(acao, fecharModal = false) {
  if (ocupado) return;
  ocupado = true;
  const admin = modalAdminAtivo();
  el("operacao").inert = true;
  if (admin) {
    admin.modal.inert = true;
    admin.status.textContent = "Aguarde…";
  }
  try {
    const mensagem = await acao();
    if (admin && fecharModal) admin.modal.close();
    (admin && !fecharModal ? admin.status : el("notice")).textContent = mensagem;
  } catch (erro) {
    (admin?.status ?? el("notice")).textContent = erro.message;
  } finally {
    ocupado = false;
    el("operacao").inert = false;
    if (admin) admin.modal.inert = false;
  }
}
function renderizarCatalogoAdmin() {
  const busca = el("buscar-produto-admin").value.trim().toLocaleLowerCase("pt-BR");
  const visiveis = catalogoAdmin.filter(p =>
    [p.nome,p.codigo,p.categoria].join(" ").toLocaleLowerCase("pt-BR").includes(busca));
  el("admin-contagem").textContent = visiveis.length + " de " + catalogoAdmin.length + " produtos ativos";
  const empresa = el("empresa").value;
  el("catalogo-gestor").replaceChildren(...visiveis.map(produto => {
    const linha = document.createElement("li");
    const dados = document.createElement("div");
    const nome = document.createElement("strong");
    nome.textContent = produto.nome;
    const detalhe = document.createElement("small");
    detalhe.textContent = [produto.codigo, produto.categoria,
      reais(produto.preco_centavos) + (produto.vendido_por_peso ? "/kg" : "")].filter(Boolean).join(" · ");
    dados.append(nome, detalhe);
    const acoes = document.createElement("div");
    acoes.className = "admin-produto-acoes";
    acoes.append(botao("Editar", () => {
      editarProduto(produto);
      abrirAdmin("cadastro-produto");
    }, true), botao("Desativar", () => operar(async () => {
      if (!window.confirm("Retirar " + produto.nome + " do catálogo ativo?")) return "";
      await atualizarProduto(empresa, produto.id, { ativo: false });
      await atualizar();
      return "Produto retirado do catálogo.";
    }), true));
    linha.append(dados, acoes);
    return linha;
  }));
  if (!visiveis.length) {
    const vazio = document.createElement("li");
    vazio.textContent = "Nenhum produto encontrado.";
    el("catalogo-gestor").append(vazio);
  }
}
el("buscar-produto-admin").oninput = renderizarCatalogoAdmin;

async function carregarOperadores(apenasCozinha = false) {
  const empresa = el("empresa").value;
  const aviso = el(apenasCozinha ? "aviso-operadores-kds" : "aviso-lista-operadores");
  const lista = el(apenasCozinha ? "email-permissao-kds" : "operadores-da-loja");
  const salvar = el("permissao-kds").querySelector("button");
  const atualizarLista = el("atualizar-lista-operadores");
  const controle = apenasCozinha ? salvar : atualizarLista;
  controle.disabled = true;
  lista.replaceChildren();
  aviso.textContent = "Carregando equipe…";
  try {
    const operadores = await executar("listar_operadores_gestor", { p_empresa: empresa });
    if (empresa !== el("empresa").value) return;
    if (apenasCozinha) {
      const cozinha = operadores.filter(operador => operador.cozinha);
      lista.replaceChildren(new Option("Selecione um operador", ""), ...cozinha.map(operador =>
        new Option(operador.email + (operador.edita_comanda ? " · pode ajustar comandas" : " · sem acesso a ajustes"), operador.email)));
      aviso.textContent = cozinha.length ? "" : "Cadastre um operador de Cozinha · KDS para configurar esta permissão.";
      salvar.disabled = !cozinha.length;
    } else {
      lista.replaceChildren(...operadores.map(operador => {
        const linha = document.createElement("li");
        linha.className = "row";
        const descricao = document.createElement("span");
        const email = document.createElement("strong");
        email.textContent = operador.email;
        const perfis = [];
        if (operador.vendas) perfis.push(operador.caixas.length ? `Vendas (${operador.caixas.join(", ")})` : "Vendas (sem caixa atribuído)");
        if (operador.cozinha) perfis.push(operador.edita_comanda ? "Cozinha · ajustes autorizados" : "Cozinha");
        descricao.append(email, document.createElement("br"), perfis.join(" / "));
        linha.append(descricao, botao("Remover da loja", () => {
          if (!window.confirm(`Remover o acesso de ${operador.email} a esta loja? O histórico dos turnos será mantido.`)) return;
          void operar(async () => {
            await executar("remover_operador_loja", { p_empresa: empresa, p_email: operador.email });
            await carregarOperadores();
            await atualizar();
            return "Acesso à loja removido.";
          });
        }, true));
        return linha;
      }));
      aviso.textContent = operadores.length ? "" : "Nenhum operador cadastrado nesta loja.";
    }
  } catch (erro) {
    if (empresa === el("empresa").value) aviso.textContent = erro.message;
  } finally {
    if (!apenasCozinha) atualizarLista.disabled = false;
  }
}
el("atualizar-lista-operadores").onclick = () => carregarOperadores();
for (const acao of document.querySelectorAll("[data-admin-abrir]")) {
  acao.onclick = () => {
    const id = acao.dataset.adminAbrir;
    if (id === "cadastro-produto") editarProduto();
    abrirAdmin(id);
    if (id === "lista-operadores") void carregarOperadores();
    if (id === "permissao-kds") void carregarOperadores(true);
  };
}
function renderizarProdutos() {
  const busca = el("buscar-produto-frente").value.trim().toLocaleLowerCase("pt-BR");
  const grupos = new Map();
  for (const produto of produtos) {
    const categoria = produto.categoria?.trim() || "Sem categoria";
    if (![produto.codigo,produto.nome,categoria].join(" ").toLocaleLowerCase("pt-BR").includes(busca)) continue;
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(produto);
  }
  el("products").replaceChildren(...[...grupos].map(([categoria,itens]) => {
    const secao = document.createElement("section");
    const titulo = document.createElement("h3");
    titulo.textContent = categoria;
    const grade = document.createElement("div");
    grade.className = "products";
    grade.append(...itens.map(produto => {
      const item = botao(produto.nome, () => {
        el("dialogo-produtos").close();
        adicionarProduto(produto);
        if (!dialogoPesagem.open) el("search").focus();
      }, true);
      const detalhe = document.createElement("small");
      detalhe.textContent = produto.codigo + " · " + reais(produto.preco) + (produto.vendido_por_peso ? "/kg" : "");
      item.append(detalhe);
      return item;
    }));
    secao.append(titulo,grade);
    return secao;
  }));
  if (!grupos.size) el("products").textContent = "Nenhum produto encontrado.";
}
function adicionarProduto(produto) {
  if (vendaPendente || adicionalPendente || pixFrente.atual() || comandaAberta?.ajuste_pendente || comandaAberta?.pix_presencial_pendente) return;
  if (produto.vendido_por_peso) {
    abrirPesagem(produto);
    return;
  }
  const quantidade = el("quantidade-frente").valueAsNumber;
  const soma = (carrinho.get(produto.codigo) ?? 0) + quantidade;
  if (!Number.isInteger(quantidade) || quantidade < 1 || soma > (comandaAberta ? 100 : 1000)) {
    el("notice").textContent = "Informe uma quantidade válida. Em adicionais, o limite é 100 por produto.";
    return;
  }
  carrinho.set(produto.codigo, soma);
  el("quantidade-frente").value = "1";
  el("search").value = "";
  renderizar();
}

function abrirPesagem(produto) {
  if (!estado.sessao || !comandaAberta || comandaAberta.ajuste_pendente || comandaAberta.pix_presencial_pendente || pixFrente.atual()) {
    el("notice").textContent = "Abra o caixa e uma comanda de mesa para lançar este produto.";
    return;
  }
  itemPesagem = { produto, pedido: comandaAberta.id };
  const retirar = Boolean(produto.pesagem);
  el("titulo-pesagem").textContent = retirar ? "Retirar lançamento" : "Adicionar produto por peso";
  el("produto-pesagem").textContent = produto.nome + " · " + (retirar ? reais(produto.preco) : reais(produto.preco) + "/kg");
  el("retirada-pesagem").hidden = !retirar;
  el("motivo-pesagem").disabled = !retirar;
  el("motivo-pesagem").value = "";
  el("aviso-pesagem").textContent = "";
  pesagem.abrir(retirar ? null : produto.preco);
  dialogoPesagem.showModal();
}

el("fechar-pesagem").onclick = () => dialogoPesagem.close();
el("form-pesagem").onsubmit = async evento => {
  evento.preventDefault();
  if (dialogoPesagem.inert) return;
  const { produto, pedido } = itemPesagem;
  const retirada = produto.pesagem?.id;
  const dados = {
    p_empresa: el("empresa").value, p_pedido: pedido, p_caixa: estado.sessao.id,
    p_produto: retirada ? null : produto.id, p_retirar: retirada ?? null,
    p_motivo: retirada ? el("motivo-pesagem").value.trim() : "Lançamento no caixa",
    ...(retirada ? { p_gramas: null, p_valor: null } : pesagem.dados())
  };
  const chave = JSON.stringify(dados);
  if (tentativaPesagem?.chave !== chave) tentativaPesagem = { chave, id: crypto.randomUUID() };
  dialogoPesagem.inert = true;
  try {
    await executar("ajustar_item_pesado", { ...dados, p_id: tentativaPesagem.id });
    tentativaPesagem = undefined;
    await carregarComandas();
    dialogoPesagem.close();
    el("notice").textContent = retirada ? "Lançamento retirado da comanda." : "Produto lançado na comanda.";
  } catch (erro) {
    el("aviso-pesagem").textContent = erro.message;
  } finally {
    dialogoPesagem.inert = false;
  }
};

function renderizar() {
  const sessao = estado.sessao;
  el("status").textContent = sessao ? "Caixa aberto" : "Caixa fechado";
  el("terminal-pdv").disabled = Boolean(sessao);
  el("balance").textContent = sessao ? "Dinheiro esperado: " + reais(saldo(sessao)) : "Abra o caixa para registrar vendas.";
  el("amount-label").textContent = sessao ? "Valor da movimentação ou dinheiro contado" : "Saldo inicial em dinheiro";
  el("cash-actions").replaceChildren(...(sessao ? ["Suprimento", "Sangria", "Fechar caixa"] : ["Abrir caixa"])
    .map(acao => botao(acao, () => operarCaixa(acao), acao !== "Abrir caixa")));
  el("mesa-frente").textContent = comandaAberta?.mesa ?? "Balcão";
  el("cliente-frente").textContent = comandaAberta?.cliente ?? "Consumidor";
  el("comanda-frente").textContent = comandaAberta?.comanda ?? "—";
  const pixAtivo = pixFrente.atual();
  el("retomar-pix-frente").hidden = !sessao || !ambientePixFrente || Boolean(pixAtivo);
  const outroPix = comandaAberta?.pix_presencial_pendente && !pixAtivo;
  el("status-ajuste-frente").hidden = !comandaAberta?.ajuste_pendente && !outroPix;
  el("status-ajuste-frente").textContent = outroPix ? "Comanda com cobrança Pix em aberto" :
    comandaAberta?.cancelamento_pendente ? "Cancelamento aguardando o gestor" : "Aguardando resolução de ajuste";
  el("titulo-venda-frente").textContent = comandaAberta ? "Itens da comanda" : "Itens da venda";
  el("voltar-balcao").hidden = !comandaAberta;
  const ajustePendente = comandaAberta?.ajuste_pendente || outroPix;
  el("empresa").disabled = Boolean(pixAtivo);
  el("abrir-comandas").disabled = el("voltar-balcao").disabled = el("abrir-cancelamentos-caixa").disabled = Boolean(pixAtivo);
  el("search").disabled = Boolean(adicionalPendente || ajustePendente || pixAtivo);
  el("quantidade-frente").disabled = Boolean(adicionalPendente || ajustePendente || pixAtivo);
  el("abrir-produtos").disabled = Boolean(adicionalPendente || vendaPendente || ajustePendente || pixAtivo);
  el("desconto-frente").hidden = Boolean(comandaAberta) || !empresasGerenciadas.has(el("empresa").value);
  el("valor-desconto").disabled = Boolean(vendaPendente || pixAtivo);
  el("cart-vazio").hidden = temItens();
  const itensBase = pixAtivo?.itens ?? comandaAberta?.itens ?? [];
  const itens = [...itensBase.map(item => ({
    ...item, codigo: produtos.find(p => p.id === item.produto_id)?.codigo ?? "—",
    preco: item.preco_centavos, original: true
  })), ...produtos.filter(p => !pixAtivo?.itens && carrinho.has(p.codigo)).map(p => ({ ...p, preco: precoAdicional(p), nome: comandaAberta ? "Adicional · " + p.nome : p.nome, quantidade: carrinho.get(p.codigo) }))];
  el("cart").replaceChildren(...itens.map(produto => {
    const { quantidade } = produto;
    const linha = document.createElement("tr");
    const medida = produto.pesagem ? detalhePesagem(produto.pesagem) : quantidade;
    const unitario = produto.pesagem ? (produto.pesagem.preco_quilo_centavos ? reais(produto.pesagem.preco_quilo_centavos) + "/kg" : "—") : reais(produto.preco);
    for (const texto of [produto.codigo, produto.nome, medida, unitario, reais(produto.preco * quantidade)]) {
      linha.insertCell().textContent = texto;
    }
    const acoes = linha.insertCell();
    if (produto.original) {
      if (produto.pesagem && estado.sessao && !ajustePendente && !pixAtivo) acoes.append(botao("Retirar", () => abrirPesagem(produto), true));
      else acoes.textContent = "—";
      return linha;
    }
    const remover = botao("−", () => {
      if (vendaPendente || adicionalPendente || pixFrente.atual()) return;
      if (quantidade === 1) carrinho.delete(produto.codigo);
      else carrinho.set(produto.codigo, quantidade - 1);
      renderizar();
    }, true);
    remover.setAttribute("aria-label", "Remover uma unidade de " + produto.nome);
    acoes.append(remover);
    return linha;
  }));
  el("salvar-adicionais").hidden = !comandaAberta || !carrinho.size;
  el("salvar-adicionais").disabled = !estado.sessao || Boolean(ajustePendente || pixAtivo);
  el("salvar-adicionais").textContent = adicionalPendente ? "Tentar envio dos adicionais novamente" : "Enviar adicionais da comanda";
  atualizarTotalFrente();
  for (const opcao of opcoesPagamento) opcao.disabled = Boolean(vendaPendente || pixAtivo);
  const ultimo = estado.fechamentos.at(-1);
  el("closing").textContent = ultimo ? "Último fechamento · esperado " + reais(ultimo.esperado) +
    " · contado " + reais(ultimo.contado) + " · diferença " + reais(ultimo.contado - ultimo.esperado) : "";
  const historico = sessao?.movimentos ?? ultimo?.movimentos ?? [];
  el("history").replaceChildren(...historico.slice(-8).reverse().map(registro => {
    const linha = document.createElement("li");
    linha.textContent = registro.tipo + " · " + reais(registro.valor) + (registro.meio ? " · " + registro.meio : "");
    return linha;
  }));
  if (!historico.length) el("history").textContent = "Nenhum registro neste caixa.";
  renderizarProdutos();
}

function atualizarTotalFrente() {
  el("subtotal-frente").textContent = reais(subtotal());
  el("total").textContent = reais(total());
  const recebido = el("valor-recebido-frente").valueAsNumber;
  const recebidoCentavos = Math.round(recebido * 100);
  el("troco-frente").textContent = reais(Number.isFinite(recebidoCentavos) ? Math.max(0, recebidoCentavos - total()) : 0);
  const comandaBloqueada = comandaAberta && (carrinho.size || comandaAberta.adicionais_pendentes || comandaAberta.ajuste_pendente || comandaAberta.pix_presencial_pendente);
  el("finish").textContent = meioSelecionado === "Pix" && ambientePixFrente ? "F4 ou Enter · Gerar QR Code" : "F4 ou Enter · Finalizar venda";
  el("finish").hidden = Boolean(pixFrente.atual());
  el("finish").disabled = !estado.sessao || Boolean(comandaBloqueada || pixFrente.atual()) || !temItens() || !meioSelecionado || total() <= 0 || desconto() < 0 ||
    (meioSelecionado === "Dinheiro" && Number.isFinite(recebidoCentavos) && recebidoCentavos < total());
}
el("valor-desconto").oninput = atualizarTotalFrente;
el("valor-recebido-frente").oninput = atualizarTotalFrente;

function operarCaixa(acao) {
  const campo = el("amount");
  if (!campo.reportValidity()) return;
  const valor = Math.round(campo.valueAsNumber * 100);
  if (!Number.isSafeInteger(valor)) return;
  operar(async () => {
    const p_caixa = estado.sessao?.id;
    if (acao === "Abrir caixa") {
      const terminal = el("terminal-pdv").value;
      if (!terminal) throw new Error("Peça ao gestor para vincular um caixa à sua conta.");
      await executar("abrir_caixa", { p_empresa: el("empresa").value, p_abertura: valor, p_terminal: terminal });
    } else if (acao === "Fechar caixa") {
      if (temItens()) throw new Error("Conclua ou esvazie a venda atual antes de fechar o caixa.");
      await executar("fechar_caixa", { p_caixa, p_contado: valor });
    } else {
      await executar("movimentar_caixa", { p_caixa, p_tipo: acao.toLowerCase(), p_valor: valor });
    }
    campo.value = "";
    await atualizar();
    return "Caixa atualizado.";
  });
}

el("login").addEventListener("submit", evento => {
  evento.preventDefault();
  operar(async () => {
    usuario = await entrar(el("email").value, el("password").value);
    el("operador-frente").textContent = "Operador · " + el("email").value;
    el("password").value = "";
    const [empresas, vinculos] = await Promise.all([
      listar("empresas?select=id,nome&order=nome"),
      listar("membros?select=empresa_id&papel=eq.gestor")
    ]);
    empresasGerenciadas = new Set(vinculos.map(vinculo => vinculo.empresa_id));
    area = el("entrada").value;
    const disponiveis = area === "administracao" ? empresas.filter(e => empresasGerenciadas.has(e.id)) : empresas;
    if (!disponiveis.length) throw new Error("Seu usuário ainda não tem acesso a um estabelecimento nesta área.");
    el("empresa").replaceChildren(...disponiveis.map(e => new Option(e.nome, e.id)));
    await atualizar();
    el("area-vendas").hidden = area !== "vendas";
    el("area-administracao").hidden = area !== "administracao";
    el("login").hidden = true;
    el("operacao").hidden = false;
    if (area === "vendas") {
      void carregarCozinha();
      void carregarComandas();
      void carregarAjustesCaixa();
    }
    return "Estabelecimento carregado.";
  });
});

el("empresa").addEventListener("change", () => operar(async () => {
  carrinho.clear();
  comandaAberta = undefined;
  vendaPendente = undefined;
  limparPagamento();
  el("resultado-mesa").hidden = true;
  editarProduto();
  estado.sessao = null;
  estado.fechamentos = [];
  produtos = [];
  if (area === "vendas") {
    renderizar();
    void carregarCozinha();
    void carregarComandas();
  }
  await atualizar();
  return "Estabelecimento carregado.";
}));
el("configurar-mesa").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    const mesa = await executar("configurar_mesa_cardapio", {
      p_empresa: el("empresa").value, p_numero: el("numero-mesa").valueAsNumber
    });
    const link = new URL("./cardapio.html", location.href);
    link.search = new URLSearchParams(mesa);
    el("link-mesa").value = link.href;
    el("resultado-mesa").hidden = false;
    return "Link da mesa disponível.";
  });
};
el("trocar-area").onclick = () => {
  if (temItens() || vendaPendente) {
    el("notice").textContent = "Conclua ou esvazie a venda atual antes de trocar de área.";
    return;
  }
  location.reload();
};
el("configurar-pdv").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_nome_pdv", { p_empresa: el("empresa").value, p_nome: el("nome-pdv").value.trim() });
    await atualizar();
    return "Nome do PDV atualizado.";
  }, true);
};
el("novo-operador-perfil").onchange = () => {
  el("novo-operador-terminal").hidden = el("novo-operador-perfil").value === "cozinha";
};
el("permissao-kds").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_edicao_kds", {
      p_empresa: el("empresa").value, p_email: el("email-permissao-kds").value.trim(),
      p_permitir: el("modo-permissao-kds").value === "conceder"
    });
    evento.target.reset();
    return "Permissão da cozinha atualizada.";
  }, true);
};
el("cadastrar-operador").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    const senha = el("novo-operador-senha");
    const perfil = el("novo-operador-perfil").value;
    try {
      await cadastrarOperador({
        empresa: el("empresa").value, email: el("novo-operador-email").value.trim(),
        senha: senha.value, perfil, caixa: perfil === "vendas" ? el("novo-operador-caixa").value.trim() || null : null
      });
    } finally {
      senha.value = "";
    }
    evento.target.reset();
    el("novo-operador-perfil").onchange();
    await atualizar();
    return perfil === "cozinha" ? "Conta exclusiva do KDS cadastrada." : "Operador cadastrado e vinculado ao estabelecimento.";
  }, true);
};
el("editar-terminal").onchange = () => {
  const terminal = terminais.find(t => t.id === el("editar-terminal").value);
  el("nome-terminal").value = terminal?.nome ?? "";
  el("email-operador").value = terminal?.email ?? "";
};
el("configurar-terminal").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_terminal_pdv", {
      p_empresa: el("empresa").value, p_terminal: el("editar-terminal").value || null,
      p_nome: el("nome-terminal").value.trim(), p_email: el("email-operador").value.trim()
    });
    await atualizar();
    return "Caixa e operador configurados.";
  }, true);
};

el("cash").addEventListener("submit", evento => evento.preventDefault());
function previaAparencia() {
  aplicarTema(el("previa-aparencia"), el("cor-cardapio").value, el("fundo-cardapio").value);
  for (const tipo of ["logo", "agradecimento"]) {
    const img = el("previa-" + tipo);
    img.hidden = !aparencia[tipo];
    if (aparencia[tipo]) img.src = aparencia[tipo];
    else img.removeAttribute("src");
  }
}
el("cor-cardapio").oninput = previaAparencia;
el("fundo-cardapio").onchange = previaAparencia;
for (const tipo of ["logo", "agradecimento"]) {
  el(tipo + "-cardapio").onchange = () => operar(async () => {
    const campo = el(tipo + "-cardapio");
    if (!campo.files.length) return "";
    try {
      aparencia[tipo] = await otimizarImagem(campo.files[0], tipo === "logo"
        ? { lado: 320, limite: 32000, quadrada: false } : { lado: 900, quadrada: false });
      previaAparencia();
      return "Imagem otimizada. Salve a aparência para publicar.";
    } finally {
      campo.value = "";
    }
  });
}
el("restaurar-aparencia").onclick = () => {
  el("aparencia-cardapio").reset();
  aparencia = { logo: null, agradecimento: null };
  previaAparencia();
  modalAdminAtivo().status.textContent = "Visual padrão na prévia. Salve para publicar.";
};
el("aparencia-cardapio").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_aparencia_cardapio", {
      p_empresa: el("empresa").value, p_cor: el("cor-cardapio").value, p_fundo: el("fundo-cardapio").value,
      p_logo: aparencia.logo, p_agradecimento: aparencia.agradecimento
    });
    return "Aparência publicada no cardápio.";
  }, true);
};
el("configuracao-entrega").addEventListener("submit", evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_pagamento_na_entrega", {
      p_empresa: el("empresa").value,
      p_habilitado: el("pagamento-na-entrega").checked
    });
    return "Configuração de entrega salva.";
  }, true);
});
function editarProduto(produto) {
  produtoEditado = produto;
  el("cadastro-produto").reset();
  el("cadastro-produto").querySelector("h2").textContent = produto ? "Editar produto" : "Cadastrar produto";
  el("produto-modo-venda").value = produto?.vendido_por_peso ? "peso" : "unidade";
  if (!produto) { configurarModoProduto(); return; }
  el("produto-visivel").checked = produto.visivel_cardapio;
  el("produto-preparo").checked = produto.preparo_cozinha;
  for (const campo of ["codigo", "nome", "categoria", "descricao", "composicao"]) {
    el("produto-" + campo).value = produto[campo] ?? "";
  }
  el("produto-preco").value = produto.preco_centavos / 100;
  el("produto-queridinho").checked = produto.queridinho;
  configurarModoProduto();
}
function configurarModoProduto() {
  const pesado = el("produto-modo-venda").value === "peso";
  el("orientacao-produto-peso").hidden = !pesado;
  el("rotulo-produto-preco").textContent = pesado ? "Preço por quilo (R$)" : "Preço unitário (R$)";
  for (const id of ["produto-visivel", "produto-preparo", "produto-queridinho"]) {
    el(id).disabled = pesado;
    if (pesado) el(id).checked = false;
  }
}
el("produto-modo-venda").onchange = configurarModoProduto;
el("cancelar-produto").onclick = () => editarProduto();
el("cadastro-produto").addEventListener("submit", evento => {
  evento.preventDefault();
  operar(async () => {
    const codigo = el("produto-codigo").value.trim();
    const nome = el("produto-nome").value.trim();
    const preco_centavos = Math.round(el("produto-preco").valueAsNumber * 100);
    if (!codigo || !nome || !Number.isSafeInteger(preco_centavos) || preco_centavos < 1) {
      throw new Error("Informe código, nome e preço válido.");
    }
    const empresa = el("empresa").value;
    const foto = el("produto-foto").files[0];
    const dados = { codigo, nome, preco_centavos, vendido_por_peso: el("produto-modo-venda").value === "peso",
      visivel_cardapio: el("produto-visivel").checked, preparo_cozinha: el("produto-preparo").checked, queridinho: el("produto-queridinho").checked };
    for (const campo of ["categoria", "descricao", "composicao"]) dados[campo] = el("produto-" + campo).value.trim() || null;
    if (foto) dados.foto_cardapio = await otimizarImagem(foto);
    const editando = Boolean(produtoEditado);
    if (editando) await atualizarProduto(empresa, produtoEditado.id, dados);
    else await cadastrarProduto({ empresa_id: empresa, ...dados });
    editarProduto();
    await atualizar();
    return editando ? "Produto atualizado." : "Produto cadastrado.";
  }, true);
});
function receberPedido(id, meio, valorConferido) {
  return operar(async () => {
  if (!estado.sessao) throw new Error("Abra o caixa antes de receber o pedido.");
  if (!window.confirm("Registrar " + reais(valorConferido) + " em " + meio + "?")) return "";
  const valor = await executar("receber_comanda_conferida", {
    p_caixa: estado.sessao.id,
    p_pedido: id,
    p_meio: meios[meio],
    p_total: valorConferido
  });
  if (comandaAberta?.id === id) {
    comandaAberta = undefined;
    limparPagamento();
  }
  await atualizar();
  void carregarCozinha();
  void carregarComandas();
  return "Recebimento registrado · " + reais(valor);
  });
}
el("fila-cozinha").addEventListener("receber-pedido", evento => {
  void receberPedido(evento.detail.id, el("meio-pedido-cozinha").value, evento.detail.total);
});

async function carregarComandas() {
  if (area !== "vendas" || el("operacao").hidden) return;
  const atual = ++consultaComandas;
  const lista = el("comandas-pendentes");
  const empresa = el("empresa").value;
  try {
    const comandas = await executar("comandas_pendentes", {
      p_empresa: empresa, p_busca: el("buscar-comanda").value
    });
    if (atual !== consultaComandas || empresa !== el("empresa").value) return;
    if (comandaAberta) {
      const atualizada = comandas.find(c => c.id === comandaAberta.id);
      if (atualizada) { comandaAberta = atualizada; renderizar(); }
      else { el("notice").textContent = "Comanda recebida ou indisponível. Volte ao balcão."; comandaAberta.adicionais_pendentes = true; atualizarTotalFrente(); }
    }
    const resultado = JSON.stringify([empresa, comandas]);
    if (resultado === ultimaListaComandas) return;
    ultimaListaComandas = resultado;
    lista.replaceChildren(...comandas.map(comanda => {
      const linha = document.createElement("div");
      linha.className = "row";
      linha.append("Mesa " + comanda.mesa + " · Comanda " + comanda.comanda + " · " +
        comanda.cliente + " · " + reais(comanda.total_centavos), botao("Carregar comanda", () => {
          if (carrinho.size || vendaPendente || adicionalPendente) {
            el("aviso-comandas").textContent = "Conclua ou esvazie a venda de balcão primeiro.";
            return;
          }
          comandaAberta = comanda;
          el("dialogo-comandas").close();
          limparPagamento();
          renderizar();
          abrirPagamento();
        }));
      return linha;
    }));
    if (!comandas.length) lista.textContent = "Nenhuma comanda pendente para esta busca.";
  } catch (erro) {
    if (atual !== consultaComandas) return;
    ultimaListaComandas = undefined;
    lista.textContent = erro.message;
  }
}
el("buscar-comanda").oninput = carregarComandas;
el("abrir-comandas").onclick = () => {
  el("aviso-comandas").textContent = "";
  el("dialogo-comandas").showModal();
  void carregarComandas();
};
el("fechar-comandas").onclick = () => el("dialogo-comandas").close();
el("voltar-balcao").onclick = () => {
  if (adicionalPendente) return;
  if (carrinho.size && !window.confirm("Descartar os adicionais ainda não enviados?")) return;
  carrinho.clear();
  comandaAberta = undefined;
  limparPagamento();
  renderizar();
};
setInterval(() => {
  if (document.hidden) return;
  void carregarComandas();
  void carregarAjustesCaixa();
}, 5000);
function abrirPagamento() {
  el("pagamento-pdv").hidden = false;
  el("abrir-pagamento-pdv").hidden = true;
  (vendaPendente ? el("finish") : opcoesPagamento[0]).focus();
}
function selecionarPagamento(opcao) {
  if (vendaPendente || pixFrente.atual()) return;
  meioSelecionado = opcao.dataset.meioPdv;
  const pixAutomatico = meioSelecionado === "Pix" && ambientePixFrente;
  if (pixAutomatico) pixFrente.selecionar(ambientePixFrente === "sandbox");
  else pixFrente.ocultar();
  el("titulo-pagamento-frente").textContent = meioSelecionado === "Pix" ? (pixAutomatico ? "Pix automático" : "Pix · Conferência no caixa")
    : meioSelecionado === "Cartão" ? "Cartão · Maquininha" : "Dinheiro · Recebimento";
  el("dinheiro-frente").hidden = meioSelecionado !== "Dinheiro";
  el("detalhe-pagamento-frente").hidden = false;
  for (const item of opcoesPagamento) {
    item.setAttribute("aria-pressed", String(item === opcao));
    item.classList.toggle("secondary", item !== opcao);
  }
  el("orientacao-frente").textContent = meioSelecionado === "Pix" ? (pixAutomatico ? "Gere o QR Code para o cliente pagar." : "Confirme o Pix recebido antes de registrar.")
    : meioSelecionado === "Cartão" ? "Confirme a aprovação na maquininha antes de registrar."
    : "Confira o dinheiro recebido antes de registrar.";
  atualizarTotalFrente();
  el(meioSelecionado === "Dinheiro" ? "valor-recebido-frente" : pixAutomatico && ambientePixFrente !== "sandbox" ? "email-pix-frente" : "finish").focus();
}
function limparPagamento() {
  pixFrente.ocultar();
  meioSelecionado = undefined;
  for (const opcao of opcoesPagamento) {
    opcao.setAttribute("aria-pressed", "false");
    opcao.classList.add("secondary");
  }
  el("pagamento-pdv").hidden = true;
  el("abrir-pagamento-pdv").hidden = false;
  el("orientacao-frente").textContent = "Selecione a forma de pagamento.";
  el("valor-desconto").value = "";
  el("valor-recebido-frente").value = "";
  el("detalhe-pagamento-frente").hidden = true;
}
el("abrir-pagamento-pdv").onclick = abrirPagamento;
el("retomar-pix-frente").onclick = () => operar(async () => {
  const retomado = await pixFrente.recuperar(true);
  return retomado ? "" : "Nenhum Pix em aberto neste caixa.";
});
for (const opcao of opcoesPagamento) opcao.onclick = () => selecionarPagamento(opcao);
document.addEventListener("keydown", evento => {
  if (area !== "vendas" || el("operacao").hidden || el("dialogo-comandas").open || el("dialogo-produtos").open ||
      el("resolver-ajuste-caixa").open || dialogoPesagem.open || el("dialogo-cancelamentos").open ||
      ocupado || evento.ctrlKey || evento.altKey || evento.metaKey) return;
  if (evento.key === "F3") {
    evento.preventDefault();
    abrirPagamento();
  } else if (/^[123]$/.test(evento.key) && el("pagamento-pdv").contains(document.activeElement) &&
      !document.activeElement.matches("input")) {
    evento.preventDefault();
    selecionarPagamento(opcoesPagamento[Number(evento.key) - 1]);
  } else if (evento.key === "F4" && !el("pagamento-pdv").hidden) {
    evento.preventDefault();
    if (!el("finish").disabled) el("sale").requestSubmit(el("finish"));
  } else if (evento.key === "F6" && !el("desconto-frente").hidden) {
    evento.preventDefault();
    el("valor-desconto").focus();
  } else if (evento.key === "F7") {
    evento.preventDefault();
    el("abrir-comandas").click();
  } else if (evento.key === "F9") {
    evento.preventDefault();
    el("abrir-produtos").click();
  }
});
el("sale").addEventListener("submit", evento => {
  evento.preventDefault();
  if (el("finish").disabled) return;
  if (meioSelecionado === "Pix" && ambientePixFrente) {
    void pixFrente.iniciar({ p_caixa: estado.sessao.id, p_pedido: comandaAberta?.id ?? null,
      p_total: total(), p_desconto: desconto(), p_itens: produtos.filter(p => carrinho.has(p.codigo)).map(p => ({
        produto_id: p.id, quantidade: carrinho.get(p.codigo)
      })) }, ambientePixFrente === "sandbox");
    return;
  }
  if (comandaAberta) {
    void receberPedido(comandaAberta.id, meioSelecionado, comandaAberta.total_centavos);
    return;
  }
  operar(async () => {
    vendaPendente ??= {
      p_caixa: estado.sessao.id,
      p_venda: crypto.randomUUID(),
      p_meio: meios[meioSelecionado],
      p_desconto: desconto(),
      p_itens: produtos.filter(p => carrinho.has(p.codigo)).map(p => ({
        produto_id: p.id, quantidade: carrinho.get(p.codigo)
      }))
    };
    const valor = await executar("registrar_venda_com_desconto", vendaPendente);
    vendaPendente = undefined;
    carrinho.clear();
    limparPagamento();
    renderizar();
    await atualizar();
    requestAnimationFrame(() => el("search").focus());
    return "Venda registrada · " + reais(valor);
  });
});
el("abrir-produtos").onclick = () => {
  el("buscar-produto-frente").value = "";
  renderizarProdutos();
  el("dialogo-produtos").showModal();
  el("buscar-produto-frente").focus();
};
el("fechar-produtos").onclick = () => el("dialogo-produtos").close();
el("buscar-produto-frente").oninput = renderizarProdutos;
el("search").addEventListener("keydown", evento => {
  if (evento.key !== "Enter") return;
  evento.preventDefault();
  const busca = el("search").value.trim().toLocaleLowerCase("pt-BR");
  if (!busca) return;
  const exato = produtos.find(p => p.codigo.toLocaleLowerCase("pt-BR") === busca);
  const candidatos = produtos.filter(p => p.nome.toLocaleLowerCase("pt-BR").includes(busca));
  if (exato || candidatos.length === 1) adicionarProduto(exato ?? candidatos[0]);
});
limparPagamento();
renderizar();
configurarCancelamentos({ comandaAtual: () => comandaAberta, atualizar: (id, resultado) => {
  if (resultado === "cancelado" && comandaAberta?.id === id) {
    comandaAberta = undefined;
    adicionalPendente = undefined;
    carrinho.clear();
    limparPagamento();
    renderizar();
  }
  void carregarComandas();
  void carregarCozinha();
} });

el("salvar-adicionais").onclick = () => operar(async () => {
  if (!estado.sessao || !comandaAberta || !carrinho.size) throw new Error("Abra o caixa e selecione os adicionais.");
  adicionalPendente ??= { p_caixa: estado.sessao.id, p_pedido: comandaAberta.id, p_id: crypto.randomUUID(),
    p_itens: produtos.filter(p => carrinho.has(p.codigo)).map(p => ({produto_id:p.id,quantidade:carrinho.get(p.codigo)})) };
  const resultado = await executar("adicionar_itens_comanda", adicionalPendente);
  comandaAberta = {...comandaAberta,...resultado,adicionais_pendentes:true};
  adicionalPendente = undefined;
  carrinho.clear();
  limparPagamento();
  renderizar();
  await carregarComandas();
  void carregarCozinha();
  return "Adicionais registrados. A cozinha recebe somente os novos itens que exigem preparo.";
});
