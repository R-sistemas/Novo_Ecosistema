import { erroApi, iniciar, supabase, tokenDe, uuid } from "../../lib/supabase.mjs";

const data = /^\d{4}-\d{2}-\d{2}$/;
const instante = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const texto = (valor, limite) => typeof valor === "string" && valor.length <= limite;

function consulta(query = {}) {
  const { acao = "", empresa = "", autor = "", inicio = "", fim = "", cursor_em = "", cursor_id = "" } = query;
  if (!texto(acao, 88) || (acao && !/^central\.[a-z0-9_.]{1,80}$/.test(acao)) ||
      !texto(empresa, 120) || !texto(autor, 254) ||
      !texto(inicio, 10) || (inicio && !data.test(inicio)) ||
      !texto(fim, 10) || (fim && !data.test(fim)) || (inicio && fim && inicio > fim) ||
      !texto(cursor_em, 40) || !texto(cursor_id, 36) || Boolean(cursor_em) !== Boolean(cursor_id) ||
      (cursor_em && (!instante.test(cursor_em) || !uuid.test(cursor_id)))) return null;
  return { p_acao: acao || null, p_empresa: empresa.trim() || null, p_autor: autor.trim() || null,
    p_inicio: inicio || null, p_fim: fim || null, p_cursor_em: cursor_em || null, p_cursor_id: cursor_id || null };
}

export default async function auditoria(req, res) {
  if (!iniciar(req, res, ["GET"])) return;
  const token = tokenDe(req);
  if (!token) return erroApi(res, 401);
  const dados = consulta(req.query);
  if (!dados) return erroApi(res, 400);
  try {
    const resposta = await supabase("/rest/v1/rpc/central_auditoria_global", { token, dados });
    const corpo = await resposta.json();
    if (!resposta.ok) return erroApi(res, ["22007", "22008", "22023"].includes(corpo.code) ? 400 : resposta.status);
    return res.status(200).json(corpo);
  } catch {
    return erroApi(res, 503);
  }
}
