import { executar } from "../../supabase-pdv.mjs";

export const consultarCardapio = dados => executar("ver_cardapio", dados);
export const consultarPedido = dados => executar("acompanhar_pedido", dados);
export const consultarDisponibilidadePix = dados => executar("pix_online_disponivel", dados);
export const consultarPagamentoNaEntrega = dados => executar("pagamento_na_entrega_disponivel", dados);
export const enviarPedido = dados => executar("enviar_pedido", dados);

export async function consultarFrete(dados) {
  const resposta = await fetch("/api/cotar-frete", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados)
  });
  return { ok: resposta.ok, resultado: await resposta.json().catch(() => ({})) };
}

export async function registrarEntrega(dados, entrega, teste) {
  const rota = teste ? "/api/checkout-pix-mercado-pago-teste" : "/api/checkout-pix-mercado-pago-quiosque";
  const resposta = await fetch(rota, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...dados, ...entrega })
  });
  return { status: resposta.status, ok: resposta.ok, resultado: await resposta.json() };
}
