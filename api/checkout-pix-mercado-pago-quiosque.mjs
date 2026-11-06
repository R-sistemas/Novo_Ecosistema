import { checkout } from "./checkout-pix-mercado-pago-teste.mjs";

export default function handler(req, res) {
  const token = process.env.MERCADO_PAGO_QUIOSQUE_WEBHOOK_SECRET
    ? process.env.MERCADO_PAGO_QUIOSQUE_ACCESS_TOKEN : undefined;
  return checkout(req, res, { sandbox: false, token });
}
