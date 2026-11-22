import { erroApi, iniciar, supabase, tokenDe, uuid } from "../../lib/supabase.mjs";

function consulta(query = {}) {
  const { busca = "", pagina = "1" } = query;
  if (typeof busca !== "string" || busca.length > 120 ||
      typeof pagina !== "string" || !/^[1-9]\d{0,5}$/.test(pagina) || Number(pagina) > 100000) return null;
  return { p_busca: busca, p_pagina: Number(pagina), p_limite: 20 };
}

function edicao(corpo = {}) {
  const { id, revisao, estado, plano, preco_centavos, vencimento, pagamento, motivo, requisicao } = corpo ?? {};
  if (!uuid.test(id ?? "") || !uuid.test(requisicao ?? "") || !Number.isInteger(revisao) ||
      !["sem_classificacao", "ativa"].includes(estado) || ![null, "basico", "pro"].includes(plano) ||
      (preco_centavos !== null && (!Number.isInteger(preco_centavos) || preco_centavos < 0 || preco_centavos > 2147483647)) ||
      (vencimento !== null && (typeof vencimento !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento))) ||
      !["pendente", "pago"].includes(pagamento) || typeof motivo !== "string" || motivo.trim().length < 1 ||
      motivo.trim().length > 240) return null;
  return {
    p_empresa: id, p_revisao: revisao, p_estado: estado, p_plano: plano, p_preco_centavos: preco_centavos,
    p_vencimento: vencimento, p_pagamento: pagamento, p_motivo: motivo.trim(), p_requisicao: requisicao
  };
}

export default async function empresas(req, res) {
  if (!iniciar(req, res, ["GET", "POST"])) return;
  const token = tokenDe(req);
  if (!token) return erroApi(res, 401);
  const leitura = req.method === "GET";
  const dados = leitura ? consulta(req.query) : edicao(req.body);
  if (!dados) return erroApi(res, 400);
  try {
    const rpc = leitura ? "central_empresas" : "central_editar_licenca";
    const resposta = await supabase("/rest/v1/rpc/" + rpc, { token, dados });
    const corpo = await resposta.json();
    if (!resposta.ok) return erroApi(res, corpo.code === "P0002" ? 404 : resposta.status);
    return res.status(200).json(corpo);
  } catch {
    return erroApi(res, 503);
  }
}
