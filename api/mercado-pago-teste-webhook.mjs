import { receberNotificacao } from "../lib/mercado-pago-webhook.mjs";

export { receberNotificacao };

export default function handler(req, res) {
  return receberNotificacao(req, res, {
    segredo: process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET,
    token: process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN,
    sandbox: true
  });
}
