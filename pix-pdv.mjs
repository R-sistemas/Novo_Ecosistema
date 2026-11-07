import { executarApi } from "./supabase-pdv.mjs";

const el = id => document.getElementById(id);
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const api = dados => executarApi("checkout-pix-mercado-pago-quiosque", { fluxo: "frente-caixa", ...dados });
const finais = {
  cancelado: "Cobrança cancelada. Se necessário, gere um novo Pix.",
  expirado: "Cobrança expirada. Gere um novo Pix.",
  rejeitado: "A cobrança foi recusada. Confira os dados e tente novamente."
};

export function configurarPixPdv({ caixa, atualizar, recebido }) {
  const painel = el("pix-frente");
  const email = el("email-pix-frente");
  const status = el("status-pix-frente");
  const imagem = el("qr-pix-frente");
  const codigo = el("codigo-pix-frente");
  let cobranca;
  let ocupado = false;
  let verificandoCaixa;

  function exibir({ teste, mensagem = "", imagem: qr, copiaECola } = {}) {
    painel.hidden = false;
    const aberta = Boolean(cobranca);
    el("dados-pix-frente").hidden = aberta || Boolean(teste);
    email.disabled = aberta || Boolean(teste);
    el("consultar-pix-frente").hidden = !aberta;
    el("cancelar-pix-frente").hidden = !aberta;
    el("consultar-pix-frente").disabled = ocupado;
    el("cancelar-pix-frente").disabled = ocupado;
    imagem.hidden = !qr;
    if (qr) imagem.src = "data:image/png;base64," + qr;
    else imagem.removeAttribute("src");
    codigo.value = copiaECola ?? "";
    codigo.disabled = !copiaECola;
    el("copiar-pix-frente").hidden = !copiaECola;
    if (status.textContent !== mensagem) status.textContent = mensagem;
  }

  async function aplicar(resultado, contexto) {
    if (!resultado) {
      cobranca = undefined;
      exibir({ teste: contexto.teste, mensagem: "Nenhuma cobrança em aberto neste caixa." });
      atualizar(false);
      return;
    }
    if (resultado.estado === "confirmado") {
      cobranca = undefined;
      painel.hidden = true;
      email.disabled = true;
      await recebido(resultado);
      return;
    }
    if (finais[resultado.estado]) {
      cobranca = undefined;
      exibir({ teste: resultado.teste, mensagem: finais[resultado.estado] });
      atualizar(false, resultado);
      return;
    }
    cobranca = { ...contexto, ...resultado };
    const valor = moeda.format(resultado.valor / 100);
    exibir({ ...resultado, mensagem: (resultado.teste ? "Pix de teste · " : "") + `Aguardando pagamento · ${valor}` });
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

  async function iniciar(dados, teste) {
    if (ocupado || cobranca) return;
    if (!teste) {
      email.required = true;
      if (!email.reportValidity()) { email.focus(); return; }
    }
    const contexto = { ...dados, id: crypto.randomUUID(), teste };
    cobranca = contexto;
    ocupado = true;
    exibir({ teste, mensagem: "Preparando o QR Code…" });
    atualizar(true);
    try {
      const resultado = await api({ ...dados, acao: "criar", p_id: contexto.id, p_email: teste ? null : email.value.trim() });
      await aplicar(resultado, contexto);
    } catch (erro) {
      if (erro.status === 400) {
        cobranca = undefined;
        exibir({ teste, mensagem: erro.message });
        atualizar(false);
      } else status.textContent = erro.message;
    } finally {
      ocupado = false;
      el("consultar-pix-frente").disabled = el("cancelar-pix-frente").disabled = false;
    }
  }

  el("consultar-pix-frente").onclick = () => consultar();
  el("cancelar-pix-frente").onclick = () => consultar("cancelar");
  el("botao-copiar-pix-frente").onclick = async () => {
    try { await navigator.clipboard.writeText(codigo.value); }
    catch { codigo.select(); }
  };
  setInterval(() => { if (!document.hidden && cobranca) void consultar(); }, 5000);
  return {
    selecionar(teste) { if (!cobranca) exibir({ teste }); },
    ocultar() { painel.hidden = true; email.disabled = true; email.required = false; email.value = ""; },
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
