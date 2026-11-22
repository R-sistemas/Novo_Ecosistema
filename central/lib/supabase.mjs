export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function iniciar(req, res, metodos) {
  res.setHeader("Cache-Control", "private, no-store");
  if (metodos.includes(req.method)) return true;
  res.setHeader("Allow", metodos.join(", "));
  res.status(405).json({ erro: "Método indisponível." });
  return false;
}

export function tokenDe(req) {
  return /^Bearer [\w.-]+$/.test(req.headers.authorization ?? "") ? req.headers.authorization : null;
}

export function supabase(caminho, { token, dados, metodo = dados === undefined ? "GET" : "POST" } = {}) {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: apikey } = process.env;
  if (!url || !apikey) throw new Error("Supabase indisponível");
  return fetch(new URL(caminho, url), {
    method: metodo, signal: AbortSignal.timeout(8000),
    headers: { apikey, ...(token && { Authorization: token }), "Content-Type": "application/json" },
    body: dados === undefined ? undefined : JSON.stringify(dados)
  });
}

export function contextoCentral(token) {
  return supabase("/rest/v1/rpc/painel_contexto_sessao", { token, dados: { p_empresa_id: null } });
}

export function erroApi(res, status) {
  const mensagens = {
    400: "Confira os dados informados.", 401: "Entre com sua conta central ou verifique o código.",
    403: "Acesso central negado.", 404: "Empresa indisponível.",
    409: "Conflito ao salvar. Recarregue o inventário.",
    429: "Muitas tentativas. Aguarde e tente novamente.", 503: "Serviço indisponível. Tente novamente."
  };
  const codigo = Object.hasOwn(mensagens, status) ? status : 503;
  return res.status(codigo).json({ erro: mensagens[codigo] });
}
