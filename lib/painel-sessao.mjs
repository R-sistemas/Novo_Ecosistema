export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function chamarSupabasePainel(authorization) {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: apikey } = process.env;
  if (!url || !apikey) return undefined;
  return (caminho, opcoes = {}) => fetch(new URL(caminho, url), {
    ...opcoes,
    headers: { apikey, Authorization: authorization, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000)
  });
}

export async function painelSessao(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer \S+$/i.test(authorization)) {
    return res.status(401).json({ erro: "sessao_invalida" });
  }
  const empresa = req.query?.empresa_id;
  if (empresa !== undefined && (typeof empresa !== "string" || !uuid.test(empresa))) {
    return res.status(400).json({ erro: "empresa_invalida" });
  }

  const chamar = chamarSupabasePainel(authorization);
  if (!chamar) return res.status(503).json({ erro: "sessao_indisponivel" });

  try {
    const sessao = await chamar("/auth/v1/user");
    if ([401, 403].includes(sessao.status)) return res.status(401).json({ erro: "sessao_invalida" });
    if (!sessao.ok) throw new Error("Falha ao verificar a sessão");
    const usuario = await sessao.json();
    if (!uuid.test(usuario?.id ?? "")) return res.status(401).json({ erro: "sessao_invalida" });

    const contexto = await chamar("/rest/v1/rpc/painel_contexto_sessao", {
      method: "POST",
      body: JSON.stringify({ p_empresa_id: empresa ?? null })
    });
    if (contexto.status === 401) return res.status(401).json({ erro: "sessao_invalida" });
    if (contexto.status === 403) return res.status(403).json({ erro: "acesso_negado" });
    if (!contexto.ok) throw new Error("Falha ao consultar o vínculo");

    const dados = await contexto.json();
    const escopo = empresa === undefined ? "central" : "loja";
    if (dados?.escopo !== escopo || dados.usuario_id !== usuario.id ||
        dados.empresa_id !== (empresa?.toLowerCase() ?? null) ||
        !Array.isArray(dados.capacidades) || !dados.capacidades.includes(escopo + ".sessao")) {
      return res.status(403).json({ erro: "acesso_negado" });
    }
    return res.status(200).json(dados);
  } catch {
    return res.status(502).json({ erro: "sessao_indisponivel" });
  }
}
