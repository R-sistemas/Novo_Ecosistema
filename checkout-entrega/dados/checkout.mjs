import { configuracaoCartao } from "../../cardapio/regras/cartao.mjs";
import { executar } from "../../supabase-pdv.mjs";

export async function consultarMetodos(slug) {
  const [pagamentoNaEntrega, metodosOnline, mp] = await Promise.all([
    executar("pagamento_na_entrega_disponivel", { p_slug: slug }).catch(() => false),
    executar("metodos_checkout_publico", { p_slug: slug }).catch(() => ({ pix: false, credito: false, debito: false })),
    executar("opcoes_mp_cardapio", { p_slug: slug }).catch(() => null)
  ]);
  const metodos = typeof mp?.pix === "boolean" ? mp : metodosOnline;
  return { pagamentoNaEntrega, metodosOnline: { ...metodos, credito: Boolean(configuracaoCartao(mp)) } };
}

export async function consultarFrete(slug, endereco, signal) {
  const resposta = await fetch("/api/cotar-frete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_slug: slug, endereco }), signal
  });
  return { ok: resposta.ok, resultado: await resposta.json().catch(() => ({})) };
}

export async function registrarEntrega(dados) {
  const resposta = await fetch("/api/checkout-pix-mercado-pago-quiosque", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados)
  });
  return { ok: resposta.ok, status: resposta.status, resultado: await resposta.json().catch(() => ({})) };
}
