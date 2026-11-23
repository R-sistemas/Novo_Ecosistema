import { editar } from "../dados/central.mjs";
import { dadosLicenca, resumoLicenca, situacaoLicenca, rotuloSuspensao } from "../regras/licenca.mjs";
import { controlesSuspensao } from "./suspensao.mjs";
import { controlesCiclo } from "./ciclo.mjs";
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
    for (const id of ["suspensao", "quitar-ciclo"]) el(id).inert = ativo;
    [salvar, cancelar, voltar, nav, el("nav-auditoria")].forEach(botao => { botao.disabled = ativo; });
  }

  const mostrarSuspensao = controlesSuspensao(() => retornar(true), sair, bloquear);

  const mostrarCiclo = controlesCiclo(() => retornar(true), sair, bloquear);

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
    const selos = [selo(resumo.pagamento)];
    if (empresa.situacao) selos.push(selo(situacaoLicenca(empresa)));
    el("pagamento-editor").replaceChildren(...selos);
    el("modo-suspensao").textContent = rotuloSuspensao[empresa.modo_suspensao] ?? "";
    mostrarSuspensao(empresa);
    mostrarCiclo(empresa);
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
    mostrarSuspensao();
    mostrarCiclo();
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
    if (dados.vencimento && dados.vencimento !== empresa.vencimento && !dados.vencimento.endsWith("-05")) {
      mensagem("Escolha um vencimento no dia 5.");
      return;
    }
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
