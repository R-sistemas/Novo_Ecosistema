import credencialMP from "../lib/credencial-mercado-pago-http.mjs";
import webhookMP from "../lib/mercado-pago-empresa-webhook.mjs";

import { licenciamentoPix, webhookLicenciamento } from "../lib/licenciamento-pagamentos.mjs";

import { licenciamentoCartao } from "../lib/licenciamento-cartao.mjs";

export default function mercadoPagoEmpresa(req, res) {
  switch (req.query?.operacao_mp) {
    case "licenca_cartao": return licenciamentoCartao(req, res);
    case "licenca_pix": return licenciamentoPix(req, res);
    case "licenca_webhook": return webhookLicenciamento(req, res);
    case "credencial": return credencialMP(req, res);
    case "webhook": return webhookMP(req, res);
    default: return res.status(404).end();
  }
}
