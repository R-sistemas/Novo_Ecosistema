import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { bearer } from "./cadastro-operador.mjs";
import { dataValida } from "../admin/regras/periodo.mjs";

const erros = {400:"periodo_invalido",401:"sessao_invalida",403:"acesso_negado"};

export async function painelVisao(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow","GET");
    return res.status(405).end();
  }
  const sessao = req.headers.authorization;
  if (!bearer(sessao)) return res.status(401).json({erro:erros[401]});
  const {empresa_id,inicio,fim} = req.query ?? {};
  if (typeof empresa_id !== "string" || !uuid.test(empresa_id) || !dataValida(inicio) || !dataValida(fim)) {
    return res.status(400).json({erro:erros[400]});
  }
  const chamar = chamarSupabasePainel(sessao);
  if (!chamar) return res.status(503).json({erro:"indicadores_indisponiveis"});
  try {
    const r = await chamar("/rest/v1/rpc/painel_visao_geral",{
      method:"POST",body:JSON.stringify({p_empresa:empresa_id,p_inicio:inicio,p_fim:fim})
    });
    if (r.ok) return res.status(200).json(await r.json());
    if (erros[r.status]) return res.status(r.status).json({erro:erros[r.status]});
  } catch {
    return res.status(502).json({erro:"indicadores_indisponiveis"});
  }
  return res.status(502).json({erro:"indicadores_indisponiveis"});
}
