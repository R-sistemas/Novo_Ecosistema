import { createHash, timingSafeEqual } from "node:crypto";

const hash = valor => createHash("sha256").update(valor).digest();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const { ASAAS_SANDBOX_WEBHOOK_TOKEN: token, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  if (!token || !url || !chave) return res.status(503).end();

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

  try {
    const resposta = await fetch(new URL("/rest/v1/asaas_sandbox_eventos?on_conflict=evento_id", url), {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: "Bearer " + chave,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify({ evento_id: id, cobranca_id: payment.id, tipo: event }),
      signal: AbortSignal.timeout(5000)
    });
    return res.status(resposta.ok ? 200 : 503).end();
  } catch {
    return res.status(503).end();
  }
}
