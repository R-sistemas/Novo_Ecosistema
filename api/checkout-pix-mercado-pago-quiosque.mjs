import { checkout } from "./checkout-pix-mercado-pago-teste.mjs";
import { pixFrenteCaixa } from "../lib/pix-frente-caixa.mjs";

export default function handler(req, res) {
  if (req.body?.fluxo === "frente-caixa") return pixFrenteCaixa(req, res);
  const token = process.env.MERCADO_PAGO_QUIOSQUE_WEBHOOK_SECRET
    ? process.env.MERCADO_PAGO_QUIOSQUE_ACCESS_TOKEN : undefined;
  return checkout(req, res, { sandbox: false, token });
}
