import { executarApi } from "../../supabase-pdv.mjs";

export const cartaoLicenca = (acao, dados) =>
  executarApi("mercado-pago-empresa?operacao_mp=licenca_cartao", {acao, ...dados});

let sdk;
export function carregarCamposCartao() {
  if (globalThis.MercadoPago) return Promise.resolve(globalThis.MercadoPago);
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.onload = () => globalThis.MercadoPago ? resolve(globalThis.MercadoPago) : reject(new Error());
    script.onerror = reject;
    document.head.append(script);
  }).catch(erro => { sdk = undefined; throw erro; });
  return sdk;
}
