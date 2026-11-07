const acesso = "__Secure-rs-monitor-acesso";
const renovacao = "__Secure-rs-monitor-renovacao";
const semana = 7 * 24 * 60 * 60;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function cookie(nome, valor, idade) {
  return `${nome}=${encodeURIComponent(valor)}; Max-Age=${idade}; Path=/api/monitor-gestor; HttpOnly; Secure; SameSite=Strict`;
}

function lerCookie(req, nome) {
  const entrada = (req.headers.cookie ?? "").split("; ").find(item => item.startsWith(nome + "="));
  try { return entrada ? decodeURIComponent(entrada.slice(nome.length + 1)) : ""; }
  catch { return ""; }
}

function guardar(res, sessao) {
  res.setHeader("Set-Cookie", [
    cookie(acesso, sessao?.access_token ?? "", sessao ? Math.max(1, Math.floor(sessao.expires_in) - 15) : 0),
    cookie(renovacao, sessao?.refresh_token ?? "", sessao ? semana : 0)
  ]);
}

export async function monitorGestor(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers.origin !== "https://" + req.headers.host ||
      !req.headers["content-type"]?.startsWith("application/json")) {
    return res.status(403).json({ erro: "Abra o monitor no endereço do sistema." });
  }
  const { acao, email, senha, empresa, dia } = req.body ?? {};
  if (acao === "sair") {
    guardar(res);
    return res.status(204).end();
  }
  if (!["entrar", "lojas", "consultar"].includes(acao) ||
      (acao === "entrar" && (typeof email !== "string" || !email || email.length > 254 ||
        typeof senha !== "string" || !senha || senha.length > 1024)) ||
      (acao === "consultar" && (typeof empresa !== "string" || !uuid.test(empresa) ||
        typeof dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia) ||
        !Number.isFinite(Date.parse(dia)) || new Date(dia).toISOString().slice(0, 10) !== dia))) {
    return res.status(400).json({ erro: "Confira os dados da consulta." });
  }

  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  if (!url || !chave) return res.status(503).json({ erro: "Monitor indisponível no momento." });
  function supabase(caminho, token, dados) {
    return fetch(new URL(caminho, url), {
      method: dados === undefined ? "GET" : "POST",
      headers: {
        apikey: chave,
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(dados === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: dados === undefined ? undefined : JSON.stringify(dados),
      signal: AbortSignal.timeout(5000)
    });
  }

  let sessao;
  let token = lerCookie(req, acesso);
  const refresh = lerCookie(req, renovacao);
  const autenticar = () => acao === "entrar"
    ? supabase("/auth/v1/token?grant_type=password", null, { email, password: senha })
    : supabase("/auth/v1/token?grant_type=refresh_token", null, { refresh_token: refresh });
  const consultar = () => acao === "consultar"
    ? supabase("/rest/v1/rpc/monitor_gestor", token, { p_empresa: empresa, p_dia: dia })
    : supabase("/rest/v1/membros?select=empresas(id,nome)&papel=eq.gestor", token);

  try {
    let resposta = acao !== "entrar" && token ? await consultar() : undefined;
    if (!resposta || resposta.status === 401) {
      if (acao !== "entrar" && !refresh) return res.status(401).json({ erro: "Entre no monitor para continuar." });
      const auth = await autenticar();
      if ([400, 401, 403].includes(auth.status)) {
        if (acao !== "entrar") guardar(res);
        return res.status(401).json({ erro: acao === "entrar" ? "Confira o e-mail e a senha." : "Sua sessão terminou. Entre novamente." });
      }
      if (!auth.ok) throw new Error("Autenticação indisponível.");
      sessao = await auth.json();
      token = sessao.access_token;
      resposta = await consultar();
    }
    if (resposta.status === 403) return res.status(403).json({ erro: "Você não tem acesso ao monitor desta loja." });
    if (!resposta.ok) throw new Error("Consulta indisponível.");
    const dados = await resposta.json();
    if (acao === "consultar") {
      if (sessao) guardar(res, sessao);
      return res.status(200).json(dados);
    }
    const lojas = dados.map(vinculo => vinculo.empresas).filter(Boolean)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (!lojas.length) {
      guardar(res);
      return res.status(403).json({ erro: "O monitor é exclusivo de gestores vinculados a uma loja." });
    }
    if (sessao) guardar(res, sessao);
    return res.status(200).json({ lojas });
  } catch {
    return res.status(502).json({ erro: "Não foi possível consultar o monitor agora. Tente novamente." });
  }
}
