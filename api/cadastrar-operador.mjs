const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  if (!url || !chave) return res.status(503).json({ erro: "Cadastro indisponível." });
  const sessao = req.headers.authorization;
  if (typeof sessao !== "string" || !/^Bearer \S+$/.test(sessao)) return res.status(401).end();
  const { empresa, email, senha, caixa, perfil = "vendas" } = req.body ?? {};
  if (typeof empresa !== "string" || !uuid.test(empresa) ||
      typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof senha !== "string" || senha.length < 12 || senha.length > 72 ||
      !["vendas", "cozinha"].includes(perfil) || (perfil === "cozinha" && caixa !== null) ||
      (caixa !== null && (typeof caixa !== "string" || !caixa.trim() || caixa.length > 60))) {
    return res.status(400).json({ erro: "Confira o e-mail, a senha inicial e o nome do caixa." });
  }

  function chamar(caminho, { method = "GET", body, authorization = "Bearer " + chave } = {}) {
    return fetch(new URL(caminho, url), {
      method, headers: { apikey: chave, Authorization: authorization, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000)
    });
  }

  try {
    const autenticacao = await chamar("/auth/v1/user", { authorization: sessao });
    if (!autenticacao.ok) return res.status(401).end();
    const gestor = (await autenticacao.json()).id;
    const consulta = await chamar("/rest/v1/membros?select=papel&empresa_id=eq." + empresa + "&usuario_id=eq." + gestor);
    if (!consulta.ok) throw new Error("Consulta de perfil indisponível.");
    if (!(await consulta.json()).some(m => m.papel === "gestor")) {
      return res.status(403).json({ erro: "Somente o gestor da loja pode cadastrar operadores." });
    }

    const criada = await chamar("/auth/v1/admin/users", {
      method: "POST", body: { email, password: senha, email_confirm: true }
    });
    if (!criada.ok) {
      return res.status(criada.status < 500 ? 409 : 502).json({
        erro: "O Supabase não criou a conta. Confira se o e-mail já está cadastrado e se a senha atende aos requisitos."
      });
    }
    const operador = (await criada.json()).id;
    const cozinha = perfil === "cozinha";
    const rpc = cozinha ? "vincular_novo_usuario_kds" : "vincular_novo_operador_pdv";
    const vinculo = await chamar("/rest/v1/rpc/" + rpc, {
      method: "POST", body: { p_gestor: gestor, p_empresa: empresa, p_operador: operador, ...(cozinha ? {} : { p_caixa: caixa }) }
    });
    if (!vinculo.ok) {
      if ([400, 401, 403, 409].includes(vinculo.status)) {
        const reversao = await chamar("/auth/v1/admin/users/" + operador, { method: "DELETE" });
        if (reversao.ok) return res.status(409).json({
          erro: cozinha ? "Cadastro revertido. Confira o acesso à loja." : "Cadastro revertido. Confira se o nome do caixa já está em uso."
        });
      }
      throw new Error("Vínculo da conta não confirmado.");
    }
    return res.status(201).json({ cadastrado: true });
  } catch (erro) {
    console.error("Cadastro de operador", erro.message);
    return res.status(502).json({ erro: "Não foi possível confirmar o cadastro. Confira a lista antes de tentar novamente." });
  }
}
