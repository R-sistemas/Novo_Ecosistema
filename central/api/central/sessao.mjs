import { contextoCentral, erroApi, iniciar, supabase, tokenDe, uuid } from "../../lib/supabase.mjs";

function fatores(usuario) {
  return (usuario.factors ?? []).filter(fator => fator.factor_type === "totp" && fator.status === "verified");
}

async function identidadeCentral(token) {
  const [contexto, pessoa] = await Promise.all([contextoCentral(token), supabase("/auth/v1/user", { token })]);
  if (!pessoa.ok || !contexto.ok) {
    return { status: !pessoa.ok ? pessoa.status : contexto.status };
  }
  const [dados, usuario] = await Promise.all([contexto.json(), pessoa.json()]);
  if (dados.escopo !== "central" || dados.usuario_id !== usuario.id ||
      !dados.capacidades?.includes("central.sessao")) return { status: 403 };
  return { usuario };
}

export default async function sessao(req, res) {
  if (!iniciar(req, res, ["POST", "DELETE"])) return;
  try {
    const { acao, email, senha, fator, codigo } = req.body ?? {};
    let token = tokenDe(req);
    if (req.method === "DELETE") {
      if (!token) return erroApi(res, 401);
      const resposta = await supabase("/auth/v1/logout?scope=local", { token, metodo: "POST" });
      return resposta.ok ? res.status(200).json({}) : erroApi(res, resposta.status);
    }
    if (acao === "entrar") {
      if (typeof email !== "string" || email.length > 254 || typeof senha !== "string" || senha.length > 1024)
        return erroApi(res, 400);
      const login = await supabase("/auth/v1/token?grant_type=password", { dados: { email, password: senha } });
      if (!login.ok) return erroApi(res, login.status === 400 ? 401 : login.status);
      token = "Bearer " + (await login.json()).access_token;
    } else if (acao !== "verificar" || !uuid.test(fator ?? "") || !/^\d{6}$/.test(codigo ?? "")) {
      return erroApi(res, 400);
    }
    if (!token) return erroApi(res, 401);
    const { usuario, status } = await identidadeCentral(token);
    if (!usuario) return erroApi(res, status);
    const disponiveis = fatores(usuario);
    if (acao === "entrar") {
      if (!disponiveis.length) return res.status(403).json({ erro: "Configure o autenticador no provisionamento da conta central." });
      return res.status(200).json({
        token: token.slice(7), fatores: disponiveis.map(({ id, friendly_name }) => ({ id, nome: friendly_name }))
      });
    }
    if (!disponiveis.some(item => item.id === fator)) return erroApi(res, 403);
    const rota = "/auth/v1/factors/" + fator;
    const desafio = await supabase(rota + "/challenge", { token, dados: {} });
    if (!desafio.ok) return erroApi(res, desafio.status);
    const verificar = await supabase(rota + "/verify", {
      token, dados: { challenge_id: (await desafio.json()).id, code: codigo }
    });
    if (!verificar.ok) return erroApi(res, verificar.status === 422 ? 401 : verificar.status);
    return res.status(200).json({ token: (await verificar.json()).access_token });
  } catch {
    return erroApi(res, 503);
  }
}
