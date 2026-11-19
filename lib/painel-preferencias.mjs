import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { bearer, resolverLojaPainel } from "./cadastro-operador.mjs";
import { validarPreferencias } from "../admin/regras/preferencias.mjs";

export async function painelPreferencias(req,res) {
  res.setHeader("Cache-Control","no-store");
  const leitura = req.method === "GET";
  if (!leitura && req.method !== "POST") return res.status(405).end();
  const sessao = req.headers.authorization;
  if (!bearer(sessao)) return res.status(401).json({erro:"sessao_invalida"});
  const empresa = req.query?.empresa_id;
  if (typeof empresa !== "string" || !uuid.test(empresa)) return res.status(400).json({erro:"empresa_invalida"});
  const chamar = chamarSupabasePainel(sessao);
  if (!chamar) return res.status(503).json({erro:"preferencias_indisponiveis"});
  try {
    const contexto = await resolverLojaPainel(chamar,empresa);
    let dados = null;
    if (!leitura) {
      try { dados = validarPreferencias(req.body?.dados); }
      catch (falha) { return res.status(400).json({erro:falha.message}); }
    }
    const r = await chamar("/rest/v1/rpc/painel_preferencias", {
      method:"POST",body:JSON.stringify({p_empresa:contexto.empresa_id,p_dados:dados})
    });
    if (!r.ok) throw Object.assign(new Error(),{status:r.status});
    return res.status(200).json(await r.json());
  } catch (falha) {
    const erros = {400:"Preferências inválidas.",401:"sessao_invalida",403:"acesso_negado"};
    if (erros[falha.status]) return res.status(falha.status).json({erro:erros[falha.status]});
    return res.status(502).json({erro:"preferencias_indisponiveis"});
  }
}
