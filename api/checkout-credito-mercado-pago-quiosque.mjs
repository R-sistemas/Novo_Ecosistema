import { checkoutCredito } from "./checkout-credito-mercado-pago-teste.mjs";

export default function handler(req, res) {
  const accessToken = process.env.MERCADO_PAGO_QUIOSQUE_WEBHOOK_SECRET
    ? process.env.MERCADO_PAGO_QUIOSQUE_ACCESS_TOKEN : undefined;
  return checkoutCredito(req, res, { sandbox: false, accessToken });
}
