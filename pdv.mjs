import { saldo } from "./caixa.mjs";
import { entrar, listar, executar, cadastrarOperador, cadastrarProduto, atualizarProduto } from "./supabase-pdv.mjs";
import { carregarCozinha } from "./cozinha.mjs";
import { aplicarTema } from "./tema-cardapio.mjs";
import { otimizarImagem } from "./imagens-cardapio.mjs";

let produtos = [];
let usuario;
let empresasGerenciadas = new Set();
let ocupado = false;
let vendaPendente;
let meioSelecionado;
let area;
let terminais = [];
let produtoEditado;
let aparencia;
let consultaComandas = 0;
let ultimaListaComandas;
const estado = { sessao: null, fechamentos: [] };
const carrinho = new Map();
const meios = { Dinheiro: "dinheiro", Pix: "pix", "Cartão": "cartao" };
const el = id => document.getElementById(id);
const opcoesPagamento = [...document.querySelectorAll("[data-meio-pdv]")];
const reais = centavos => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL"
}).format(centavos / 100);
const total = () => produtos.reduce((soma, produto) =>
  soma + produto.preco * (carrinho.get(produto.codigo) ?? 0), 0);

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
  const [catalogo, caixas, configuracao, caixasDisponiveis] = await Promise.all([
    listar("produtos?ativo=eq.true&empresa_id=eq." + empresa + "&order=nome" +
      (administracao ? "" : "&select=id,codigo,nome,preco_centavos")),
    administracao ? [] : listar("caixas?empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=aberto_em.desc&limit=1"),
    listar("empresas?select=nome,nome_pdv,pagamento_na_entrega" +
      (administracao ? ",cardapio_cor,cardapio_fundo,cardapio_logo,cardapio_agradecimento" : "") + "&id=eq." + empresa),
    administracao ? executar("listar_terminais_gestor", { p_empresa: empresa })
      : listar("terminais_pdv?select=id,nome&empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=nome")
  ]);
  const nomePdv = configuracao[0].nome_pdv ?? configuracao[0].nome;
  el("nome-pdv-exibido").textContent = nomePdv;
  terminais = caixasDisponiveis;
  if (administracao) {
    const config = configuracao[0];
    aparencia = { logo: config.cardapio_logo, agradecimento: config.cardapio_agradecimento };
    el("aparencia-cardapio").reset();
    el("cor-cardapio").value = config.cardapio_cor;
    el("fundo-cardapio").value = config.cardapio_fundo;
    el("previa-nome").textContent = config.nome;
    previaAparencia();
    el("status").textContent = "Administração";
    el("nome-pdv").value = nomePdv;
    el("editar-terminal").replaceChildren(new Option("Novo caixa", ""),
      ...terminais.map(t => new Option(t.nome + " · " + t.email, t.id)));
    el("configurar-terminal").reset();
    el("cadastro-produto").hidden = false;
    el("pagamento-na-entrega").checked = configuracao[0].pagamento_na_entrega;
    el("configuracao-entrega").hidden = false;
    el("catalogo-gestor").replaceChildren(...catalogo.map(produto => {
      const linha = document.createElement("li");
      linha.append(produto.nome + " · " + reais(produto.preco_centavos) + " ",
        botao("Editar", () => editarProduto(produto), true),
        botao("Desativar", () => operar(async () => {
          if (!window.confirm("Retirar " + produto.nome + " do catálogo ativo?")) return "";
          await atualizarProduto(empresa, produto.id, { ativo: false });
          await atualizar();
          return "Produto retirado do catálogo.";
        }), true));
      return linha;
    }));
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
}

async function operar(acao) {
  if (ocupado) return;
  ocupado = true;
  el("operacao").inert = true;
  try {
    el("notice").textContent = await acao();
  } catch (erro) {
    el("notice").textContent = erro.message;
  } finally {
    ocupado = false;
    el("operacao").inert = false;
  }
}
function renderizarProdutos() {
  const busca = el("search").value.trim().toLocaleLowerCase("pt-BR");
  el("products").replaceChildren(...produtos
    .filter(produto => (produto.codigo + " " + produto.nome).toLocaleLowerCase("pt-BR").includes(busca))
    .map(produto => {
      const item = botao(produto.nome, () => {
        if (vendaPendente) return;
        carrinho.set(produto.codigo, (carrinho.get(produto.codigo) ?? 0) + 1);
        renderizar();
      }, true);
      const detalhe = document.createElement("small");
      detalhe.textContent = produto.codigo + " · " + reais(produto.preco);
      item.append(detalhe);
      return item;
    }));
}

function renderizar() {
  const sessao = estado.sessao;
  el("status").textContent = sessao ? "Caixa aberto" : "Caixa fechado";
  el("terminal-pdv").disabled = Boolean(sessao);
  el("balance").textContent = sessao ? "Dinheiro esperado: " + reais(saldo(sessao)) : "Abra o caixa para registrar vendas.";
  el("amount-label").textContent = sessao ? "Valor da movimentação ou dinheiro contado" : "Saldo inicial em dinheiro";
  el("cash-actions").replaceChildren(...(sessao ? ["Suprimento", "Sangria", "Fechar caixa"] : ["Abrir caixa"])
    .map(acao => botao(acao, () => operarCaixa(acao), acao !== "Abrir caixa")));
  el("cart").replaceChildren();
  if (!carrinho.size) el("cart").textContent = "Selecione um produto para começar.";
  for (const produto of produtos) {
    const quantidade = carrinho.get(produto.codigo);
    if (!quantidade) continue;
    const linha = document.createElement("div");
    linha.className = "row";
    const remover = botao("−", () => {
      if (vendaPendente) return;
      if (quantidade === 1) carrinho.delete(produto.codigo);
      else carrinho.set(produto.codigo, quantidade - 1);
      renderizar();
    }, true);
    remover.setAttribute("aria-label", "Remover uma unidade de " + produto.nome);
    linha.append(quantidade + " × " + produto.nome, reais(produto.preco * quantidade), remover);
    el("cart").append(linha);
  }
  el("total").textContent = reais(total());
  el("finish").disabled = !sessao || !carrinho.size || !meioSelecionado;
  for (const opcao of opcoesPagamento) opcao.disabled = Boolean(vendaPendente);
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
      if (carrinho.size) throw new Error("Conclua ou esvazie a venda atual antes de fechar o caixa.");
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
    }
    return "Estabelecimento carregado.";
  });
});

el("empresa").addEventListener("change", () => operar(async () => {
  carrinho.clear();
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
  if (carrinho.size || vendaPendente) {
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
  });
};
el("cadastrar-operador").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    const senha = el("novo-operador-senha");
    try {
      await cadastrarOperador({
        empresa: el("empresa").value, email: el("novo-operador-email").value.trim(),
        senha: senha.value, caixa: el("novo-operador-caixa").value.trim() || null
      });
    } finally {
      senha.value = "";
    }
    evento.target.reset();
    await atualizar();
    return "Operador cadastrado e vinculado ao estabelecimento.";
  });
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
  });
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
  el("notice").textContent = "Visual padrão na prévia. Salve para publicar.";
};
el("aparencia-cardapio").onsubmit = evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_aparencia_cardapio", {
      p_empresa: el("empresa").value, p_cor: el("cor-cardapio").value, p_fundo: el("fundo-cardapio").value,
      p_logo: aparencia.logo, p_agradecimento: aparencia.agradecimento
    });
    return "Aparência publicada no cardápio.";
  });
};
el("configuracao-entrega").addEventListener("submit", evento => {
  evento.preventDefault();
  operar(async () => {
    await executar("configurar_pagamento_na_entrega", {
      p_empresa: el("empresa").value,
      p_habilitado: el("pagamento-na-entrega").checked
    });
    return "Configuração de entrega salva.";
  });
});
function editarProduto(produto) {
  produtoEditado = produto;
  el("cadastro-produto").reset();
  el("cadastro-produto").querySelector("h2").textContent = produto ? "Editar produto" : "Cadastrar produto";
  if (!produto) return;
  for (const campo of ["codigo", "nome", "categoria", "descricao", "composicao"]) {
    el("produto-" + campo).value = produto[campo] ?? "";
  }
  el("produto-preco").value = produto.preco_centavos / 100;
  el("produto-queridinho").checked = produto.queridinho;
  el("cadastro-produto").scrollIntoView({ block: "start" });
}
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
    const dados = { codigo, nome, preco_centavos, queridinho: el("produto-queridinho").checked };
    for (const campo of ["categoria", "descricao", "composicao"]) dados[campo] = el("produto-" + campo).value.trim() || null;
    if (foto) dados.foto_cardapio = await otimizarImagem(foto);
    const editando = Boolean(produtoEditado);
    if (editando) await atualizarProduto(empresa, produtoEditado.id, dados);
    else await cadastrarProduto({ empresa_id: empresa, ...dados });
    editarProduto();
    await atualizar();
    return editando ? "Produto atualizado." : "Produto cadastrado.";
  });
});
function receberPedido(id, meio) {
  return operar(async () => {
  if (!estado.sessao) throw new Error("Abra o caixa antes de receber o pedido.");
  if (!window.confirm("Registrar o recebimento deste pedido em " + meio + "?")) return "";
  const valor = await executar("receber_pedido_no_caixa", {
    p_caixa: estado.sessao.id,
    p_pedido: id,
    p_meio: meios[meio]
  });
  await atualizar();
  void carregarCozinha();
  void carregarComandas();
  return "Recebimento registrado · " + reais(valor);
  });
}
el("fila-cozinha").addEventListener("receber-pedido", evento => {
  void receberPedido(evento.detail, el("meio-pedido-cozinha").value);
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
    const resultado = JSON.stringify([empresa, comandas]);
    if (resultado === ultimaListaComandas) return;
    ultimaListaComandas = resultado;
    lista.replaceChildren(...comandas.map(comanda => {
      const linha = document.createElement("div");
      linha.className = "row";
      linha.append("Mesa " + comanda.mesa + " · Comanda " + comanda.comanda + " · " +
        comanda.cliente + " · " + reais(comanda.total_centavos), botao("Receber", () =>
        receberPedido(comanda.id, el("meio-comanda").value)));
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
setInterval(() => { if (!document.hidden) void carregarComandas(); }, 5000);
function abrirPagamento() {
  el("pagamento-pdv").hidden = false;
  el("abrir-pagamento-pdv").hidden = true;
  (vendaPendente ? el("finish") : opcoesPagamento[0]).focus();
}
function selecionarPagamento(opcao) {
  if (vendaPendente) return;
  meioSelecionado = opcao.dataset.meioPdv;
  for (const item of opcoesPagamento) {
    item.setAttribute("aria-pressed", String(item === opcao));
    item.classList.toggle("secondary", item !== opcao);
  }
  el("finish").disabled = !estado.sessao || !carrinho.size;
  el("finish").focus();
}
function limparPagamento() {
  meioSelecionado = undefined;
  for (const opcao of opcoesPagamento) {
    opcao.setAttribute("aria-pressed", "false");
    opcao.classList.add("secondary");
  }
  el("pagamento-pdv").hidden = true;
  el("abrir-pagamento-pdv").hidden = false;
}
el("abrir-pagamento-pdv").onclick = abrirPagamento;
for (const opcao of opcoesPagamento) opcao.onclick = () => selecionarPagamento(opcao);
document.addEventListener("keydown", evento => {
  if (area !== "vendas" || el("operacao").hidden || ocupado || evento.ctrlKey || evento.altKey || evento.metaKey) return;
  if (evento.key === "F3") {
    evento.preventDefault();
    abrirPagamento();
  } else if (/^[123]$/.test(evento.key) && el("pagamento-pdv").contains(document.activeElement)) {
    evento.preventDefault();
    selecionarPagamento(opcoesPagamento[Number(evento.key) - 1]);
  } else if (evento.key === "F4" && !el("pagamento-pdv").hidden) {
    evento.preventDefault();
    if (!el("finish").disabled) el("sale").requestSubmit(el("finish"));
  }
});
el("sale").addEventListener("submit", evento => {
  evento.preventDefault();
  if (!estado.sessao || !carrinho.size || !meioSelecionado) return;
  operar(async () => {
    vendaPendente ??= {
      p_caixa: estado.sessao.id,
      p_venda: crypto.randomUUID(),
      p_meio: meios[meioSelecionado],
      p_itens: produtos.filter(p => carrinho.has(p.codigo)).map(p => ({
        produto_id: p.id, quantidade: carrinho.get(p.codigo)
      }))
    };
    const valor = await executar("registrar_venda", vendaPendente);
    vendaPendente = undefined;
    carrinho.clear();
    limparPagamento();
    renderizar();
    await atualizar();
    requestAnimationFrame(() => el("search").focus());
    return "Venda registrada · " + reais(valor);
  });
});
el("search").addEventListener("input", renderizarProdutos);
limparPagamento();
renderizar();
