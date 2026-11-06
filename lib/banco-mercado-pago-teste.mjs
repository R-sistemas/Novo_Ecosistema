export async function bancoMercadoPagoTeste(nome, dados) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  const resposta = await fetch(new URL("/rest/v1/rpc/" + nome, SUPABASE_URL), {
    method: "POST",
    headers: { apikey: chave, Authorization: "Bearer " + chave, "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(5000)
  });
  if (!resposta.ok) throw new Error("Supabase retornou HTTP " + resposta.status);
  return resposta.json();
}
