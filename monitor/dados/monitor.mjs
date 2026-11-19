export async function api(acao, parametros = {}) {
  const resposta = await fetch("/api/monitor-gestor", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao, ...parametros }), cache: "no-store", signal: AbortSignal.timeout(20000)
  });
  const dados = resposta.status === 204 ? null : await resposta.json();
  if (!resposta.ok) throw Object.assign(new Error(dados?.erro), { status: resposta.status });
  return dados;
}
