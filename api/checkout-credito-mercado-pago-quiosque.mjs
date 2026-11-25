import { checkoutCredito } from "./checkout-credito-mercado-pago-teste.mjs";

export default function handler(req, res) {
  return checkoutCredito(req, res, { sandbox: false });
}
