import { receberNotificacao } from "./mercado-pago-teste-webhook.mjs";

export default function handler(req, res) {
  return receberNotificacao(req, res, {
    segredo: process.env.MERCADO_PAGO_QUIOSQUE_WEBHOOK_SECRET,
    token: process.env.MERCADO_PAGO_QUIOSQUE_ACCESS_TOKEN,
    sandbox: false
  });
}
