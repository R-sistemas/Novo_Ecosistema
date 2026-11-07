import { executarApi } from "./supabase-pdv.mjs";

const el = id => document.getElementById(id);
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const api = dados => executarApi("checkout-pix-mercado-pago-quiosque", { fluxo: "frente-caixa", ...dados });
const finais = {
  cancelado: "Cobrança cancelada. Se necessário, gere um novo Pix.",
  expirado: "Cobrança expirada. Gere um novo Pix.",
  rejeitado: "A cobrança foi recusada. Confira os dados e tente novamente."
};

export function configurarPixPdv({ caixa, atualizar, recebido, aoFechar }) {
  const dialogo = el("pix-frente");
  const status = el("status-pix-frente");
  const imagem = el("qr-pix-frente");
  const codigo = el("codigo-pix-frente");
  const barra = el("progresso-pix-frente");
  const validade = el("validade-pix-frente");
  const tempo = el("tempo-pix-frente");
  let cobranca;
  let ocupado = false;
  let verificandoCaixa;
  let confirmado = false;
  let vigencia;

  function abrir() {
    if (!dialogo.open) dialogo.showModal();
  }

  function atualizarRelogio() {
    if (!vigencia || confirmado) return;
    const restante = Math.max(0, vigencia.fim - performance.now());
    const segundos = Math.ceil(restante / 1000);
    barra.value = Math.min(100, restante * 100 / vigencia.duracao);
    const mmss = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
    tempo.textContent = restante ? `${mmss} restantes` : "Prazo encerrado · verificando";
    imagem.hidden = !restante || !imagem.hasAttribute("src");
    el("copiar-pix-frente").hidden = !restante || !codigo.value;
  }

  function exibir({ mensagem = "", imagem: qr, copiaECola, validadeMs, restanteMs, sucesso = false } = {}) {
    confirmado = sucesso;
    el("titulo-pix-modal").textContent = sucesso ? "Pix recebido com sucesso" : "Pagamento via Pix";
    el("marca-pix-sucesso").hidden = !sucesso;
    el("confirmar-pix-frente").hidden = !sucesso;
    el("acoes-pix-frente").hidden = sucesso;
    const aberta = Boolean(cobranca);
    el("consultar-pix-frente").hidden = !aberta;
    el("cancelar-pix-frente").hidden = !aberta;
    el("consultar-pix-frente").disabled = ocupado;
    el("cancelar-pix-frente").disabled = ocupado;
    imagem.hidden = !qr;
    if (qr) {
      const src = "data:image/png;base64," + qr;
      if (imagem.getAttribute("src") !== src) imagem.src = src;
    }
    else imagem.removeAttribute("src");
    codigo.value = copiaECola ?? "";
    codigo.disabled = !copiaECola;
    el("copiar-pix-frente").hidden = !copiaECola;
    vigencia = Number.isFinite(validadeMs) && validadeMs > 0 && Number.isFinite(restanteMs) ?
      { duracao: validadeMs, fim: performance.now() + restanteMs } : undefined;
    validade.hidden = !vigencia;
    atualizarRelogio();
    if (status.textContent !== mensagem) status.textContent = mensagem;
  }

  async function aplicar(resultado, contexto) {
    if (!resultado) {
      cobranca = undefined;
      exibir({ mensagem: "Nenhuma cobrança em aberto neste caixa." });
      atualizar(false);
      return;
    }
    if (resultado.estado === "confirmado") {
      cobranca = undefined;
      exibir({ sucesso: true, mensagem: `${moeda.format(resultado.valor / 100)} · Venda registrada` });
      abrir();
      el("ok-pix-frente").focus({ preventScroll: true });
      await recebido(resultado);
      return;
    }
    if (finais[resultado.estado]) {
      cobranca = undefined;
      exibir({ mensagem: finais[resultado.estado] });
      atualizar(false, resultado);
      return;
    }
    const retomando = !cobranca;
    cobranca = { ...contexto, ...resultado };
    const valor = moeda.format(resultado.valor / 100);
    exibir({ ...resultado, mensagem: (resultado.teste ? "Pix de teste · " : "") + `Aguardando pagamento · ${valor}` });
    if (retomando) abrir();
    atualizar(true);
  }

  async function consultar(acao = "consultar", recuperar = false) {
    const idCaixa = caixa();
    if (!idCaixa || ocupado || (!cobranca && !recuperar)) return;
    const contexto = cobranca ?? { p_caixa: idCaixa };
    ocupado = true;
    el("consultar-pix-frente").disabled = el("cancelar-pix-frente").disabled = true;
    try {
      const resultado = await api({ acao, p_caixa: idCaixa, p_id: contexto.id ?? null });
      if (caixa() !== idCaixa || (!resultado && recuperar && !cobranca)) return false;
      await aplicar(resultado, contexto);
      if (acao === "cancelar" && cobranca) status.textContent = "O provedor ainda não confirmou o cancelamento. Confira esta cobrança.";
      return Boolean(resultado);
    } catch (erro) {
      if (!recuperar || cobranca) status.textContent = erro.message;
      else if (caixa() === idCaixa) throw erro;
    } finally {
      ocupado = false;
      el("consultar-pix-frente").disabled = el("cancelar-pix-frente").disabled = false;
    }
  }

  async function iniciar(dados) {
    if (ocupado || cobranca) return;
    const contexto = { ...dados, id: crypto.randomUUID() };
    cobranca = contexto;
    ocupado = true;
    exibir({ mensagem: "Preparando o QR Code…" });
    abrir();
    atualizar(true);
    try {
      const resultado = await api({ ...dados, acao: "criar", p_id: contexto.id });
      await aplicar(resultado, contexto);
    } catch (erro) {
      if (erro.status === 400) {
        cobranca = undefined;
        exibir({ mensagem: erro.message });
        atualizar(false);
      } else status.textContent = erro.message;
    } finally {
      ocupado = false;
      el("consultar-pix-frente").disabled = el("cancelar-pix-frente").disabled = false;
    }
  }

  el("consultar-pix-frente").onclick = () => consultar();
  el("cancelar-pix-frente").onclick = () => consultar("cancelar");
  el("voltar-pix-frente").onclick = () => dialogo.close();
  dialogo.addEventListener("close", () => aoFechar({ confirmado, ativa: Boolean(cobranca) }));
  el("botao-copiar-pix-frente").onclick = async () => {
    try { await navigator.clipboard.writeText(codigo.value); }
    catch { codigo.select(); }
  };
  setInterval(() => { if (!document.hidden && cobranca) void consultar(); }, 5000);
  setInterval(() => { if (dialogo.open) atualizarRelogio(); }, 1000);
  return {
    abrir,
    aberta: () => dialogo.open,
    iniciar,
    atual: () => cobranca,
    async recuperar(forcar = false) {
      const id = caixa();
      if (!id || cobranca || (!forcar && verificandoCaixa === id)) return;
      verificandoCaixa = id;
      try { return await consultar("consultar", true); }
      catch (erro) { verificandoCaixa = undefined; throw erro; }
    }
  };
}
