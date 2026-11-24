import { createHash, timingSafeEqual } from "node:crypto";

const hash = valor => createHash("sha256").update(valor).digest();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const { ASAAS_SANDBOX_WEBHOOK_TOKEN: token, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  if (!token || !url || !chave) {
    console.error("Configuração do webhook incompleta", {
      tokenConfigurado: Boolean(token),
      urlConfigurada: Boolean(url),
      chaveConfigurada: Boolean(chave)
    });
    return res.status(503).end();
  }

  const recebido = req.headers["asaas-access-token"];
  if (typeof recebido !== "string" || !timingSafeEqual(hash(recebido), hash(token))) {
    return res.status(401).end();
  }

  const { id, event, payment } = req.body ?? {};
  if (event !== "PAYMENT_RECEIVED") return res.status(200).end();
  if (typeof id !== "string" || !/^evt_[a-z0-9&_-]{1,200}$/i.test(id) ||
      typeof payment?.id !== "string" || !/^pay_[a-z0-9]{1,100}$/i.test(payment.id)) {
    return res.status(400).end();
  }
  const centavos = typeof payment.value === "number" ? Math.round(payment.value * 100) : null;
  if (centavos !== null && (!Number.isSafeInteger(centavos) || centavos <= 0)) {
    return res.status(400).end();
  }

  try {
    const resposta = await fetch(new URL("/rest/v1/rpc/registrar_evento_pix_sandbox", url), {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: "Bearer " + chave,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_evento: id, p_cobranca: payment.id, p_valor: centavos }),
      signal: AbortSignal.timeout(5000)
    });
    return res.status(resposta.ok ? 200 : 503).end();
  } catch {
    return res.status(503).end();
  }
}
