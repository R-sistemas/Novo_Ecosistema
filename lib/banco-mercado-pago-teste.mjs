export async function bancoMercadoPagoTeste(nome, dados, sessao) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  const resposta = await fetch(new URL("/rest/v1/rpc/" + nome, SUPABASE_URL), {
    method: "POST",
    headers: { apikey: chave, Authorization: sessao ?? "Bearer " + chave, "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    signal: AbortSignal.timeout(5000)
  });
  if (!resposta.ok) {
    const erro = sessao ? await resposta.json().catch(() => null) : null;
    const mensagem = ["P0001", "42501"].includes(erro?.code) ? erro.message : null;
    throw Object.assign(new Error(mensagem ?? "Supabase retornou HTTP " + resposta.status), { status: resposta.status, mensagem });
  }
  return resposta.json();
}
