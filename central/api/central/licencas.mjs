import { erroApi, iniciar, supabase, tokenDe, uuid } from "../../lib/supabase.mjs";

const data = /^\d{4}-\d{2}-\d{2}$/;

function pagamento(body) {
  const { empresa, revisao, vencimento, data_pagamento, valor_centavos, requisicao } = body ?? {};
  if (!uuid.test(empresa ?? "") || !uuid.test(requisicao ?? "") ||
      !Number.isInteger(revisao) || revisao < 1 || revisao > 2147483646 ||
      !Number.isInteger(valor_centavos) || valor_centavos < 1 || valor_centavos > 2147483647 ||
      typeof vencimento !== "string" || !data.test(vencimento) ||
      typeof data_pagamento !== "string" || !data.test(data_pagamento)) return null;
  return { p_empresa: empresa, p_revisao: revisao, p_vencimento: vencimento,
    p_data_pagamento: data_pagamento, p_valor_centavos: valor_centavos, p_requisicao: requisicao };
}

function historico(query) {
  const { empresa, pagina = "1" } = query ?? {};
  if (!uuid.test(empresa ?? "") || typeof pagina !== "string" ||
      !/^[1-9]\d{0,5}$/.test(pagina) || Number(pagina) > 100000) return null;
  return { p_empresa: empresa, p_pagina: Number(pagina) };
}

export default async function licencas(req, res) {
  if (!iniciar(req, res, ["GET", "POST"])) return;
  const token = tokenDe(req);
  if (!token) return erroApi(res, 401);
  const leitura = req.method === "GET";
  const dados = leitura ? historico(req.query) : pagamento(req.body);
  if (!dados) return erroApi(res, 400);
  const rpc = leitura ? "central_historico_empresa" : "central_registrar_pagamento";
  try {
    const resposta = await supabase("/rest/v1/rpc/" + rpc, { token, dados });
    const corpo = await resposta.json();
    if (!resposta.ok) {
      const status = { P0002: 404, "22023": 400, "22007": 400, "22008": 400 };
      return erroApi(res, status[corpo.code] ?? resposta.status);
    }
    return res.status(200).json(corpo);
  } catch {
    return erroApi(res, 503);
  }
}
