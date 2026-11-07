const el = id => document.getElementById(id);
const login = el("login-monitor");
const painel = el("painel-monitor");
const dadosMonitor = el("dados-monitor");
const loja = el("loja-monitor");
const dia = el("dia-monitor");
const aviso = el("aviso-monitor");
const sair = el("sair-monitor");
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" });
const formatarDia = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const reais = centavos => moeda.format(centavos / 100);
const escrever = (id, valor) => { el(id).textContent = valor; };
const estados = { novo: "Novo", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue", recusado: "Encerrado" };
const entregas = {
  sem_despacho: "Aguardando despacho", solicitada: "Despacho solicitado", aceita: "Aceita pela REMO",
  em_rota: "Em rota", entregue: "Entregue", cancelada: "Entrega cancelada"
};
const pagamentos = {
  recebido: "Pago", encerrado: "Encerrado", teste: "Pagamento de teste",
  aguardando_online: "Aguardando confirmação online", na_entrega: "Pagamento na entrega", no_caixa: "A receber no caixa"
};
const meios = { pix: "Pix", dinheiro: "Dinheiro", credito: "Crédito", debito: "Débito", cartao: "Cartão" };
const abas = { pedidos: "Pedidos", recebimentos: "Recebimentos", entregas: "Entregas" };
let aba = "pedidos";
let dados;
let consultando = false;
let encerrando = false;
let consultaAtual;
dia.value = dia.max = formatarDia.format(new Date());

async function api(acao, parametros = {}) {
  const resposta = await fetch("/api/monitor-gestor", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao, ...parametros }), cache: "no-store", signal: AbortSignal.timeout(20000)
  });
  const dados = resposta.status === 204 ? null : await resposta.json();
  if (!resposta.ok) throw Object.assign(new Error(dados?.erro), { status: resposta.status });
  return dados;
}

function mostrarLogin(mensagem = "") {
  painel.hidden = dadosMonitor.hidden = sair.hidden = true;
  login.hidden = false;
  dados = undefined;
  loja.replaceChildren();
  el("lista-monitor").replaceChildren();
  escrever("nome-monitor", "Monitor do gestor");
  aviso.textContent = mensagem;
}

function linha(titulo, descricao, valor) {
  const item = document.createElement("li");
  const corpo = document.createElement("div");
  const nome = document.createElement("strong");
  const detalhe = document.createElement("small");
  const total = document.createElement("span");
  nome.textContent = titulo;
  detalhe.textContent = descricao;
  total.textContent = reais(valor);
  corpo.append(nome, detalhe);
  item.append(corpo, total);
  return item;
}

function renderizarLista() {
  if (!dados) return;
  escrever("titulo-lista-monitor", abas[aba]);
  const registros = dados[aba];
  el("lista-monitor").replaceChildren(...registros.map(registro => {
    if (aba === "recebimentos") {
      const origem = registro.origem === "caixa" ? "Caixa" : "Online";
      const titulo = registro.comanda ? `Pedido #${registro.comanda} · ${meios[registro.meio]}` : `Venda · ${meios[registro.meio]}`;
      return linha(titulo, `${origem} · ${hora.format(new Date(registro.recebido_em))}`, registro.valor);
    }
    const destino = registro.mesa ? `Mesa ${registro.mesa}` : registro.entrega ? "Entrega" : "Retirada";
    const etapa = aba === "entregas" ? entregas[registro.entrega] : estados[registro.estado];
    return linha(`Pedido #${registro.comanda} · ${destino}`,
      `${etapa} · ${pagamentos[registro.pagamento]} · ${hora.format(new Date(registro.criado_em))}`, registro.total_centavos);
  }));
  const total = dados[aba + "_total"];
  escrever("nota-lista-monitor", !total ? "Nenhum registro neste dia." :
    total > registros.length ? `Mostrando os ${registros.length} registros mais recentes de ${total}.` : "");
}

async function atualizar() {
  if (painel.hidden || consultando || encerrando || !dia.validity.valid) return;
  const empresa = loja.value;
  const data = dia.value;
  consultando = true;
  el("atualizar-monitor").disabled = true;
  if (dadosMonitor.hidden) aviso.textContent = "Atualizando operação…";
  try {
    const resposta = await api("consultar", { empresa, dia: data });
    if (encerrando || loja.value !== empresa || dia.value !== data) return;
    dados = resposta;
    escrever("total-monitor", dados.pedidos_total);
    escrever("preparo-monitor", `${dados.em_preparo} em preparo`);
    escrever("recebido-monitor", reais(Number(dados.recebido_caixa) + Number(dados.recebido_online)));
    escrever("origens-monitor", `Caixa ${reais(dados.recebido_caixa)} · Online ${reais(dados.recebido_online)}`);
    escrever("rota-monitor", dados.em_rota);
    escrever("entregues-monitor", `${dados.entregues} com entrega concluída`);
    renderizarLista();
    escrever("sincronizado-monitor", `Atualizado às ${hora.format(new Date())} · horário de Brasília`);
    dadosMonitor.hidden = false;
    aviso.textContent = "";
  } catch (erro) {
    if (encerrando) return;
    if ([401, 403].includes(erro.status)) mostrarLogin(erro.message);
    else aviso.textContent = "A atualização falhou. Confira a conexão ou toque em Atualizar.";
  } finally {
    consultando = false;
    el("atualizar-monitor").disabled = false;
    if (loja.value !== empresa || dia.value !== data) solicitarAtualizacao();
  }
}

function mudarFiltro() {
  dados = undefined;
  dadosMonitor.hidden = true;
  escrever("nome-monitor", loja.selectedOptions[0]?.text ?? "Monitor do gestor");
  if (!dia.validity.valid) aviso.textContent = "Selecione um dia válido.";
  else solicitarAtualizacao();
}

function abrir({ lojas }) {
  loja.replaceChildren(...lojas.map(empresa => new Option(empresa.nome, empresa.id)));
  el("filtro-loja").hidden = lojas.length === 1;
  painel.hidden = sair.hidden = false;
  login.hidden = true;
  mudarFiltro();
}

login.onsubmit = async evento => {
  evento.preventDefault();
  const botao = login.querySelector("button");
  const senha = el("senha-monitor");
  botao.disabled = true;
  aviso.textContent = "Entrando…";
  try { abrir(await api("entrar", { email: el("email-monitor").value.trim(), senha: senha.value })); }
  catch (erro) { mostrarLogin(erro.status ? erro.message : "Não foi possível entrar. Confira a conexão."); }
  finally { senha.value = ""; botao.disabled = false; }
};
sair.onclick = async () => {
  encerrando = sair.disabled = true;
  try {
    // Espere uma eventual renovação de sessão antes de limpar os cookies.
    await consultaAtual;
    await api("sair");
    mostrarLogin("Você saiu do monitor.");
  } catch { aviso.textContent = "Não foi possível sair. Confira a conexão e tente novamente."; }
  finally { encerrando = sair.disabled = false; }
};
function solicitarAtualizacao() {
  if (!consultando) consultaAtual = atualizar();
}
loja.onchange = dia.onchange = mudarFiltro;
el("atualizar-monitor").onclick = solicitarAtualizacao;
const botoesAbas = [...document.querySelectorAll("[data-aba]")];
for (const botao of botoesAbas) {
  botao.onclick = () => {
    aba = botao.dataset.aba;
    for (const item of botoesAbas) item.setAttribute("aria-pressed", String(item === botao));
    renderizarLista();
  };
}
function aoVisivel() {
  if (!document.hidden) solicitarAtualizacao();
}
document.addEventListener("visibilitychange", aoVisivel);
window.addEventListener("online", aoVisivel);
setInterval(aoVisivel, 20000);
api("lojas").then(abrir).catch(erro => mostrarLogin(erro.status === 401 ? "" :
  erro.status ? erro.message : "Não foi possível carregar o monitor. Confira a conexão."));
