import { erroApi, iniciar, supabase, tokenDe, uuid } from "../../lib/supabase.mjs";

export default async function credencialMP(req, res) {
  if (!iniciar(req, res, ["GET", "POST"])) return;
  const token = tokenDe(req);
  if (!token) return erroApi(res, 401);
  const { empresa } = req.query ?? {};
  if (!uuid.test(empresa ?? "")) return erroApi(res, 400);
  const dados = { p_empresa: empresa, p_ambiente: "producao" };
  const leitura = req.method === "GET";
  if (!leitura) {
    const { integracao, revisao, canal, motivo } = req.body ?? {};
    if (!uuid.test(integracao ?? "") || !Number.isSafeInteger(revisao) || revisao < 1 ||
        !["telefone", "email", "whatsapp"].includes(canal) || typeof motivo !== "string" ||
        motivo.trim().length < 1 || motivo.trim().length > 240) return erroApi(res, 400);
    delete dados.p_ambiente;
    Object.assign(dados, { p_integracao: integracao, p_revisao: revisao, p_canal: canal, p_motivo: motivo });
  }
  try {
    const rpc = leitura ? "central_status_credencial_mp" : "central_aprovar_recebedor_mp";
    const resposta = await supabase("/rest/v1/rpc/" + rpc, { token, dados });
    if (!resposta.ok) return erroApi(res, resposta.status);
    return res.status(200).json(await resposta.json());
  } catch {
    return erroApi(res, 503);
  }
}
