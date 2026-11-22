import { editar } from "../dados/central.mjs";
import { dadosLicenca, resumoLicenca } from "../regras/licenca.mjs";
import { selo } from "./selo.mjs";

const el = id => document.getElementById(id);

export function editor(painel, atualizar, sair) {
  const detalhe = el("editor");
  const formulario = el("licenca");
  const erro = el("erro-editor");
  const aviso = el("aviso-editor");
  const salvar = formulario.querySelector("button[type=submit]");
  const cancelar = el("cancelar");
  const voltar = el("voltar-inventario");
  const nav = el("nav-inventario");
  let empresa;
  let tentativa;
  let acionador;

  function bloquear(ativo) {
    [salvar, cancelar, voltar, nav].forEach(botao => { botao.disabled = ativo; });
  }

  function mensagem(texto = "") {
    erro.textContent = texto;
    aviso.hidden = !texto;
  }

  function abrir(registro, botao) {
    empresa = registro;
    tentativa = undefined;
    acionador = botao;
    formulario.reset();
    for (const campo of ["estado", "plano", "vencimento", "pagamento"]) {
      formulario.elements[campo].value = empresa[campo] ?? "";
    }
    formulario.elements.preco.value = empresa.preco_centavos === null ? "" : empresa.preco_centavos / 100;
    const resumo = resumoLicenca(empresa);
    el("empresa-editor").textContent = empresa.nome;
    el("slug-editor").textContent = empresa.cardapio_slug ?? "Sem slug";
    el("estado-editor").textContent = resumo.estado;
    el("vencimento-editor").textContent = resumo.vencimento;
    el("atraso-editor").textContent = resumo.atraso;
    el("pagamento-editor").replaceChildren(selo(resumo.pagamento));
    mensagem();
    painel.hidden = true;
    detalhe.hidden = false;
    el("empresa-editor").focus();
    window.scrollTo(0, 0);
  }

  function fechar() {
    detalhe.hidden = true;
    tentativa = undefined;
    empresa = undefined;
    acionador = undefined;
    formulario.reset();
    el("empresa-editor").textContent = "";
    el("slug-editor").textContent = "";
    el("pagamento-editor").replaceChildren();
    mensagem();
    bloquear(false);
  }

  function retornar(recarregar = false) {
    if (detalhe.hidden) return;
    const destino = recarregar ? el("titulo-inventario") : acionador;
    fechar();
    painel.hidden = false;
    destino?.focus();
    if (recarregar) atualizar();
  }

  formulario.onsubmit = async evento => {
    evento.preventDefault();
    const dados = dadosLicenca(new FormData(formulario), empresa);
    const assinatura = JSON.stringify(dados);
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
    const atual = tentativa;
    bloquear(true);
    mensagem();
    try {
      await editar({ ...dados, requisicao: atual.id });
      if (tentativa === atual) retornar(true);
    } catch (e) {
      if (tentativa !== atual) return;
      if ([401, 403].includes(e.status)) sair();
      else mensagem(e.message);
    } finally {
      if (tentativa === atual) bloquear(false);
    }
  };

  [cancelar, voltar, nav].forEach(botao => { botao.onclick = () => retornar(); });
  return { abrir, fechar };
}
