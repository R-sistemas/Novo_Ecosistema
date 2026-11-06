import { saldo } from "./caixa.mjs";
import { entrar, listar, executar } from "./supabase-pdv.mjs";

let produtos = [];
let usuario;
let ocupado = false;
let vendaPendente;
const estado = { sessao: null, fechamentos: [] };
const carrinho = new Map();
const el = id => document.getElementById(id);
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
  const [catalogo, caixas] = await Promise.all([
    listar("produtos?ativo=eq.true&empresa_id=eq." + empresa + "&order=nome"),
    listar("caixas?empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=aberto_em.desc&limit=1")
  ]);
  const caixa = caixas[0];
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
  el("finish").disabled = !sessao || !carrinho.size;
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
      await executar("abrir_caixa", { p_empresa: el("empresa").value, p_abertura: valor });
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
    const empresas = await listar("empresas?select=id,nome&order=nome");
    if (!empresas.length) throw new Error("Seu usuário ainda não tem acesso a um estabelecimento.");
    el("empresa").replaceChildren(...empresas.map(e => new Option(e.nome, e.id)));
    await atualizar();
    el("login").hidden = true;
    el("operacao").hidden = false;
    return "Estabelecimento carregado.";
  });
});

el("empresa").addEventListener("change", () => operar(async () => {
  carrinho.clear();
  vendaPendente = undefined;
  estado.sessao = null;
  estado.fechamentos = [];
  produtos = [];
  renderizar();
  await atualizar();
  return "Estabelecimento carregado.";
}));

el("cash").addEventListener("submit", evento => evento.preventDefault());
el("sale").addEventListener("submit", evento => {
  evento.preventDefault();
  if (!estado.sessao || !carrinho.size) return;
  operar(async () => {
    const meios = { Dinheiro: "dinheiro", Pix: "pix", "Cartão": "cartao" };
    vendaPendente ??= {
      p_caixa: estado.sessao.id,
      p_venda: crypto.randomUUID(),
      p_meio: meios[el("method").value],
      p_itens: produtos.filter(p => carrinho.has(p.codigo)).map(p => ({
        produto_id: p.id, quantidade: carrinho.get(p.codigo)
      }))
    };
    const valor = await executar("registrar_venda", vendaPendente);
    vendaPendente = undefined;
    carrinho.clear();
    renderizar();
    await atualizar();
    return "Venda registrada · " + reais(valor);
  });
});
el("search").addEventListener("input", renderizarProdutos);
renderizar();