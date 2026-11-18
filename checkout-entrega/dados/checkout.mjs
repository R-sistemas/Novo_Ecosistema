import { executar } from "../../supabase-pdv.mjs";

export async function consultarMetodos(slug) {
  const [pagamentoNaEntrega, metodosOnline] = await Promise.all([
    executar("pagamento_na_entrega_disponivel", { p_slug: slug }).catch(() => false),
    executar("metodos_checkout_publico", { p_slug: slug }).catch(() => ({ pix: false, credito: false, debito: false }))
  ]);
  return { pagamentoNaEntrega, metodosOnline };
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
