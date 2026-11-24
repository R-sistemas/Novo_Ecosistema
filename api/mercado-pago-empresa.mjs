import credencialMP from "../lib/credencial-mercado-pago-http.mjs";
import webhookMP from "../lib/mercado-pago-empresa-webhook.mjs";

export default function mercadoPagoEmpresa(req, res) {
  switch (req.query?.operacao_mp) {
    case "credencial": return credencialMP(req, res);
    case "webhook": return webhookMP(req, res);
    default: return res.status(404).end();
  }
}
