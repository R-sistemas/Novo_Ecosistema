import { listarAuditoria } from "../dados/central.mjs";
import { formatarDataHora, resumirAuditoria } from "../regras/auditoria.mjs";

const el = id => document.getElementById(id);
const criar = (tag, texto) => {
  const elemento = document.createElement(tag);
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
};

function detalhe(evento) {
  const corpo = criar("details");
  corpo.append(criar("summary", "Ver detalhes"));
  const blocos = [["Antes", evento.antes], ["Depois", evento.depois]];
  for (const [titulo, registro] of blocos) {
    const campos = resumirAuditoria(registro);
    if (!campos.length) continue;
    const lista = criar("dl");
    for (const [rotulo, valor] of campos) lista.append(criar("dt", rotulo), criar("dd", valor));
    corpo.append(criar("strong", titulo), lista);
  }
  if (corpo.childElementCount === 1) corpo.append(criar("p", "Sem detalhes adicionais."));
  return corpo;
}

export function auditoria(sair) {
  const painel = el("auditoria");
  const form = el("filtros-auditoria");
  const corpo = el("eventos-auditoria");
  const status = el("status-auditoria");
  const tabela = el("tabela-auditoria");
  const anterior = el("auditoria-anterior");
  const proxima = el("auditoria-proxima");
  const repetir = el("auditoria-repetir");
  const pagina = el("auditoria-pagina");
  let filtros, proximoCursor, cursores, versao = 0;

  function linha(evento) {
    const tr = criar("tr");
    const acao = evento.acao_rotulo === "Ação central" ? evento.acao : evento.acao_rotulo;
    const colunas = [
      ["Data e hora", formatarDataHora(evento.ocorrido_em)], ["Ação", acao],
      ["Empresa", evento.empresa ?? "—"], ["Autor", evento.autor ?? "Indisponível"],
      ["Motivo", evento.motivo ?? "—"], ["Detalhe", detalhe(evento)]
    ];
    for (const [rotulo, valor] of colunas) {
      const td = tr.insertCell();
      const legenda = criar("span", rotulo);
      legenda.className = "rotulo";
      legenda.setAttribute("aria-hidden", "true");
      td.append(legenda, typeof valor === "string" ? criar("span", valor) : valor);
    }
    return tr;
  }

  async function carregar() {
    const atual = ++versao;
    anterior.disabled = proxima.disabled = true;
    tabela.hidden = repetir.hidden = true;
    status.textContent = "Carregando eventos…";
    try {
      const { eventos, tem_proxima } = await listarAuditoria(filtros, cursores.at(-1));
      if (atual !== versao) return;
      corpo.replaceChildren(...eventos.map(linha));
      tabela.hidden = !eventos.length;
      status.textContent = eventos.length ? "" : "Nenhum evento encontrado.";
      pagina.textContent = "Página " + cursores.length;
      anterior.disabled = cursores.length === 1;
      proxima.disabled = !tem_proxima;
      proximoCursor = eventos.at(-1);
    } catch (erro) {
      if (atual !== versao) return;
      if ([401, 403].includes(erro.status)) sair();
      else {
        status.textContent = erro.message;
        repetir.hidden = false;
        anterior.disabled = cursores.length === 1;
      }
    }
  }

  function consultar() {
    filtros = Object.fromEntries(new FormData(form));
    cursores = [null];
    void carregar();
  }

  form.onsubmit = evento => { evento.preventDefault(); consultar(); };
  el("auditoria-limpar").onclick = () => { form.reset(); consultar(); };
  repetir.onclick = carregar;
  anterior.onclick = () => { cursores.pop(); void carregar(); };
  proxima.onclick = () => { cursores.push(proximoCursor); void carregar(); };

  return {
    abrir() {
      if (!painel.hidden) return;
      painel.hidden = false;
      el("titulo-auditoria").focus();
      consultar();
    },
    fechar() {
      versao++;
      painel.hidden = true;
      form.reset();
      corpo.replaceChildren();
      status.textContent = pagina.textContent = "";
    }
  };
}
