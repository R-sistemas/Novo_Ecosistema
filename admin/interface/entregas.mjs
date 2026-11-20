import { listarEntregas, detalharEntrega } from "../dados/entregas.mjs";
import { estadoLogistico, estados, enderecoTexto, itemResumo, valor } from "../regras/pedidos.mjs";
import { filtrosEntregas, horarioEntrega } from "../regras/entregas.mjs";

const tela = `
  <form class="acoes filtros-painel" aria-label="Filtros de entregas">
    <label>De <input type="date" name="inicio"></label>
    <label>Até <input type="date" name="fim"></label>
    <label>Estado REMO <select name="estado"><option value="">Todos</option></select></label>
    <label>Comanda ou ID do pedido <input type="search" name="busca" maxlength="36"></label>
    <button type="submit">Aplicar filtros</button>
  </form>
  <div class="rolagem"><table aria-label="Entregas da loja"><thead><tr>
    <th>Pedido</th><th>Data e hora</th><th>Estado REMO</th><th>Status do pedido</th><th>Cobrar na entrega</th><th>Total</th>
  </tr></thead><tbody></tbody></table></div>
  <div class="acoes">
    <button type="button" data-anterior disabled>Anterior</button>
    <span role="status"></span>
    <button type="button" data-proxima disabled>Próxima</button>
  </div>
  <dialog class="pedido-drawer" aria-labelledby="titulo-detalhe-entrega">
    <h2 id="titulo-detalhe-entrega">Detalhe da entrega</h2>
    <button type="button">Fechar</button>
    <dl></dl><h3>Itens do pedido</h3><ul></ul>
  </dialog>`;

const mensagens = {400:"Confira os filtros de entrega.",401:"Sua sessão terminou. Entre novamente.",
  403:"Somente gestores da loja podem consultar entregas.",404:"Entrega indisponível nesta loja."};
const erro = falha => mensagens[falha.status] || "Não foi possível consultar as entregas.";
const pedido = e => e.comanda == null ? e.pedido_id : "Comanda " + e.comanda;

function camposDetalhe(dialogo,e) {
  const campos = {
    Entrega:e.id, Pedido:e.pedido_id, Comanda:e.comanda, Cliente:e.cliente,
    "Data do despacho":horarioEntrega(e.criado_em), REMO:estadoLogistico(e.estado_remo),
    "Status do pedido":estados[e.estado_pedido], "Cobrar na entrega":valor(e.cobrar_na_entrega_centavos),
    Total:valor(e.total_centavos), Endereço:e.destino && enderecoTexto(e.destino), Telefone:e.destino?.telefone
  };
  const dados = dialogo.querySelector("dl");
  for (const [rotulo,texto] of Object.entries(campos)) {
    if (texto == null || texto === "") continue;
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = rotulo;
    dd.textContent = texto;
    dados.append(dt,dd);
  }
  const itens = dialogo.querySelector("ul");
  for (const item of e.itens) {
    const linha = document.createElement("li");
    linha.textContent = itemResumo(item) + " · " + valor(item.preco_centavos);
    itens.append(linha);
  }
}

export function prepararEntregas(area) {
  area.innerHTML = tela;
  const achar = seletor => area.querySelector(seletor);
  const form = achar("form");
  const tabela = achar("tbody");
  const status = achar("[role=status]");
  const anterior = achar("[data-anterior]");
  const proxima = achar("[data-proxima]");
  const dialogo = achar("dialog");
  for (const estado of ["solicitada","aceita","em_rota","entregue","cancelada"]) {
    form.elements.estado.add(new Option(estadoLogistico(estado),estado));
  }
  let empresa, filtros, pagina, cursores, proximo;
  let consulta = 0, detalhe = 0;

  function fechar() {
    detalhe++;
    if (dialogo.open) dialogo.close();
    dialogo.querySelector("dl").replaceChildren();
    dialogo.querySelector("ul").replaceChildren();
  }
  dialogo.querySelector("button").onclick = fechar;
  dialogo.oncancel = evento => { evento.preventDefault(); fechar(); };

  async function abrir(id) {
    fechar();
    const atual = detalhe;
    try {
      const entrega = await detalharEntrega(empresa,id);
      if (detalhe !== atual || area.hidden) return;
      camposDetalhe(dialogo,entrega);
      dialogo.showModal();
    } catch (falha) {
      if (detalhe === atual && !area.hidden) status.textContent = erro(falha);
    }
  }

  function renderizar(entregas) {
    tabela.replaceChildren(...entregas.map(e => {
      const linha = document.createElement("tr");
      const botao = document.createElement("button");
      botao.type = "button";
      botao.textContent = pedido(e);
      botao.onclick = () => abrir(e.id);
      linha.insertCell().append(botao,document.createTextNode(" · " + e.cliente));
      for (const texto of [horarioEntrega(e.criado_em),estadoLogistico(e.estado_remo),estados[e.estado_pedido],
        valor(e.cobrar_na_entrega_centavos),valor(e.total_centavos)]) linha.insertCell().textContent = texto;
      return linha;
    }));
  }

  async function carregar(indice,cursor) {
    const atual = ++consulta;
    fechar();
    tabela.replaceChildren();
    anterior.disabled = proxima.disabled = true;
    status.textContent = "Consultando entregas…";
    try {
      const dados = await listarEntregas(empresa,filtros,cursor);
      if (consulta !== atual || area.hidden) return;
      pagina = indice;
      cursores[indice] = cursor;
      proximo = dados.proximo_cursor;
      anterior.disabled = pagina === 0;
      proxima.disabled = !proximo;
      renderizar(dados.entregas);
      status.textContent = "Página " + (pagina + 1) + (dados.entregas.length ? "" : " · Nenhuma entrega encontrada");
    } catch (falha) {
      if (consulta === atual && !area.hidden) status.textContent = erro(falha);
    }
  }

  form.onsubmit = evento => {
    evento.preventDefault();
    try { filtros = filtrosEntregas(Object.fromEntries(new FormData(form))); }
    catch (falha) { status.textContent = falha.message; return; }
    cursores = [];
    void carregar(0,null);
  };
  anterior.onclick = () => carregar(pagina - 1,cursores[pagina - 1]);
  proxima.onclick = () => carregar(pagina + 1,proximo);
  return {
    abrirLoja(loja) {
      empresa = loja;
      filtros = {};
      cursores = [];
      form.reset();
      return carregar(0,null);
    },
    limpar() {
      consulta++;
      fechar();
      tabela.replaceChildren();
    }
  };
}
