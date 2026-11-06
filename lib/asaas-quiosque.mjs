export async function consultar(url, headers, dados) {
  const resposta = await fetch(url, {
    method: dados === undefined ? "GET" : "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: dados === undefined ? undefined : JSON.stringify(dados),
    signal: AbortSignal.timeout(8000)
  });
  if (!resposta.ok) throw new Error("Integração retornou HTTP " + resposta.status);
  const corpo = await resposta.text();
  return corpo ? JSON.parse(corpo) : null;
}

export function integracaoQuiosque() {
  const { ASAAS_QUIOSQUE_PRODUCTION_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!ASAAS_QUIOSQUE_PRODUCTION_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    asaas: (rota, dados) => consultar("https://api.asaas.com/v3" + rota, {
      access_token: ASAAS_QUIOSQUE_PRODUCTION_API_KEY, "User-Agent": "R-Sistemas/1.0"
    }, dados),
    banco: (nome, dados) => consultar(new URL("/rest/v1/rpc/" + nome, SUPABASE_URL), {
      apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY
    }, dados)
  };
}

export const pedidoValido = id => typeof id === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);

export const pixRecebido = cobranca => cobranca.billingType === "PIX" &&
  cobranca.status === "RECEIVED" && !cobranca.deleted;
