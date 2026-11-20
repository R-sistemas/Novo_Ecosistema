import { listarPedidos, detalharPedido } from "../dados/pedidos.mjs";
import { buscarNaPagina, estadoLogistico, estados, filtrosPedidos, horario, identificacao,
  itemResumo, origens, pagamento, valor } from "../regras/pedidos.mjs";

const mensagens = {
  400:"Confira os filtros de pedidos.",401:"Sua sessão terminou. Entre novamente.",
  403:"Somente gestores da loja podem consultar pedidos.",404:"Pedido indisponível nesta loja."
};
const erro = falha => mensagens[falha.status] || "Não foi possível consultar os pedidos.";

function mostrarDetalhe(dialogo,pedido) {
  const texto = dialogo.querySelector("[data-pedido-dados]");
  const campos = {
    Pedido:pedido.id, Cliente:pedido.cliente, Data:horario(pedido.criado_em),
    Origem:origens[pedido.origem], Mesa:pedido.mesa, KDS:estados[pedido.estado_kds],
    Estado:estados[pedido.estado], Pagamento:pagamento(pedido), "Cobrança da entrega":pedido.pagamento_entrega,
    Mercadoria:valor(pedido.mercadoria_centavos), Desconto:valor(pedido.desconto_centavos),
    Frete:valor(pedido.frete_centavos), Total:valor(pedido.total_centavos),
    "Estado logístico":estadoLogistico(pedido.estado_entrega), "Ordem REMO":pedido.ordem_remo
  };
  if (pedido.endereco) {
    const e = pedido.endereco;
    campos.Endereço = [e.logradouro,e.numero,e.complemento,e.bairro,e.cidade,e.uf,e.cep].filter(Boolean).join(", ");
    campos.Telefone = e.telefone;
  }
  texto.replaceChildren();
  for (const [rotulo,dado] of Object.entries(campos)) {
    if (dado == null || dado === "") continue;
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = rotulo;
    dd.textContent = dado;
    texto.append(dt,dd);
  }
  const itens = dialogo.querySelector("[data-pedido-itens]");
  itens.replaceChildren(...pedido.itens.map(item => {
    const linha = document.createElement("li");
    const peso = item.pesagem;
    const preco = item.preco_centavos;
    const rotulo = peso ? "total pesado" : "unitário";
    linha.textContent = itemResumo(item) + " · " + (preco == null ? "Preço histórico indisponível" : valor(preco) + " (" + rotulo + ")");
    return linha;
  }));
  dialogo.showModal();
}

export function prepararPedidos(area) {
  const achar = seletor => area.querySelector(seletor);
  const form = achar("form");
  const busca = achar("[data-pedidos-busca]");
  const tabela = achar("tbody");
  const status = achar("[role=status]");
  const anterior = achar("[data-pedidos-anterior]");
  const proxima = achar("[data-pedidos-proxima]");
  const dialogo = achar("dialog");
  let empresa, filtros, pagina, cursores, proximo, pedidos;
  let consulta = 0;
  let detalhe = 0;

  function limparDetalhe() {
    detalhe++;
    if (dialogo.open) dialogo.close();
    dialogo.querySelector("[data-pedido-dados]").replaceChildren();
    dialogo.querySelector("[data-pedido-itens]").replaceChildren();
  }
  dialogo.querySelector("button").onclick = limparDetalhe;
  dialogo.oncancel = evento => {
    evento.preventDefault();
    limparDetalhe();
  };

  async function abrir(id) {
    const atual = ++detalhe;
    try {
      const pedido = await detalharPedido(empresa,id);
      if (detalhe === atual && !area.hidden) mostrarDetalhe(dialogo,pedido);
    } catch (falha) {
      if (detalhe === atual && !area.hidden) status.textContent = erro(falha);
    }
  }

  function renderizar() {
    const linhas = buscarNaPagina(pedidos,busca.value);
    tabela.replaceChildren(...linhas.map(pedido => {
      const tr = document.createElement("tr");
      const botao = document.createElement("button");
      botao.type = "button";
      botao.textContent = identificacao(pedido);
      botao.onclick = () => abrir(pedido.id);
      const id = tr.insertCell();
      id.append(botao,document.createTextNode(" · " + pedido.cliente));
      const resumo = pedido.resumo.map(itemResumo).join(", ");
      const mais = pedido.linhas_itens - pedido.resumo.length;
      for (const texto of [horario(pedido.criado_em),resumo + (mais > 0 ? " +" + mais : ""),
        valor(pedido.total_centavos),origens[pedido.origem],estados[pedido.estado],
        estadoLogistico(pedido.estado_entrega),pagamento(pedido)]) tr.insertCell().textContent = texto;
      return tr;
    }));
    status.textContent = "Página " + (pagina + 1) + (linhas.length ? "" : " · Nenhum pedido encontrado");
  }

  async function carregar(indice,cursor) {
    const atual = ++consulta;
    limparDetalhe();
    tabela.replaceChildren();
    pedidos = [];
    anterior.disabled = proxima.disabled = busca.disabled = true;
    status.textContent = "Consultando pedidos…";
    try {
      const dados = await listarPedidos(empresa,filtros,cursor);
      if (consulta !== atual) return;
      pagina = indice;
      cursores[indice] = cursor;
      proximo = dados.proximo_cursor;
      pedidos = dados.pedidos;
      anterior.disabled = pagina === 0;
      proxima.disabled = !proximo;
      busca.disabled = false;
      renderizar();
    } catch (falha) {
      if (consulta === atual) status.textContent = erro(falha);
    }
  }

  form.onsubmit = evento => {
    evento.preventDefault();
    try { filtros = filtrosPedidos(Object.fromEntries(new FormData(form))); }
    catch (falha) { status.textContent = falha.message; return; }
    cursores = [];
    carregar(0,null);
  };
  anterior.onclick = () => carregar(pagina-1,cursores[pagina-1]);
  proxima.onclick = () => carregar(pagina+1,proximo);
  busca.oninput = renderizar;

  function abrirLoja(loja,campos={},intervalo={}) {
    empresa = loja;
    form.reset();
    busca.value = "";
    for (const [chave,valor] of Object.entries(campos)) form.elements[chave].value = valor;
    filtros = intervalo;
    cursores = [];
    return carregar(0,null);
  }
  return {abrirLoja, limparDetalhe};
}
