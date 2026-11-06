export async function consultar(url, headers, dados) {
  const resposta = await fetch(url, {
    method: dados === undefined ? "GET" : "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: dados === undefined ? undefined : JSON.stringify(dados),
    signal: AbortSignal.timeout(8000)
  });
  const corpo = await resposta.text();
  if (!resposta.ok) {
    const erro = new Error("Integração retornou HTTP " + resposta.status);
    try {
      const dadosErro = JSON.parse(corpo);
      const codigo = dadosErro.errors?.[0]?.code ?? dadosErro.code;
      if (typeof codigo === "string" && /^[a-z0-9_]{1,60}$/i.test(codigo)) erro.codigo = codigo;
      const descricao = dadosErro.errors?.[0]?.description;
      if (typeof descricao === "string" && /m[ií]nim/i.test(descricao)) {
        erro.minimo = descricao.match(/R\$\s*\d+(?:[,.]\d{2})?/i)?.[0];
      }
    } catch {
      // Uma resposta fora do formato esperado preserva o status HTTP.
    }
    throw erro;
  }
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
