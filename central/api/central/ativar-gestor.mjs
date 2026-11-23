import { erroApi, iniciar, supabase, tokenDe } from "../../lib/supabase.mjs";

export default async function ativarGestor(req, res) {
  if (!iniciar(req, res, ["POST"])) return;
  const token = tokenDe(req);
  if (!token) return erroApi(res, 401);
  const { senha } = req.body ?? {};
  if (typeof senha !== "string" || senha.length < 12 || new TextEncoder().encode(senha).length > 72)
    return erroApi(res, 400);
  try {
    const convite = await supabase("/rest/v1/rpc/central_gestor_convidado", { token, dados: {} });
    if (!convite.ok) return erroApi(res, convite.status);
    if (await convite.json() !== true) return erroApi(res, 403);
    const resultado = await supabase("/auth/v1/user", { token, metodo: "PUT", dados: { password: senha } });
    if (!resultado.ok) return erroApi(res, [401, 403].includes(resultado.status) ? 401 : resultado.status);
    await supabase("/auth/v1/logout?scope=local", { token, metodo: "POST" }).catch(() => {});
    return res.status(200).json({});
  } catch {
    return erroApi(res, 503);
  }
}
