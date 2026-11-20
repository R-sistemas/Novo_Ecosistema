import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { bearer } from "./cadastro-operador.mjs";

const erros = {400:"dados_invalidos",401:"sessao_invalida",403:"acesso_negado",404:"mesa_indisponivel",409:"comanda_aberta"};

export async function painelMesas(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow","GET, POST");
    return res.status(405).end();
  }
  const sessao=req.headers.authorization;
  if (!bearer(sessao)) return res.status(401).json({erro:erros[401]});
  const empresa=req.query?.empresa_id;
  const {acao,numero,ativo}=req.body ?? {};
  const leitura=req.method === "GET";
  if (typeof empresa !== "string" || !uuid.test(empresa) ||
      (!leitura && (!Number.isInteger(numero) || numero < 1 || numero > 999 ||
        !["criar","situacao"].includes(acao) || (acao === "situacao" && typeof ativo !== "boolean")))) {
    return res.status(400).json({erro:erros[400]});
  }
  const chamar=chamarSupabasePainel(sessao);
  if (!chamar) return res.status(503).json({erro:"mesas_indisponiveis"});
  try {
    const r=await chamar("/rest/v1/rpc/painel_mesas",{
      method:"POST",body:JSON.stringify(leitura ? {p_empresa:empresa,p_acao:"listar"} :
        {p_empresa:empresa,p_acao:acao,p_numero:numero,p_ativo:ativo})
    });
    if (r.ok) return res.status(200).json(await r.json());
    if (erros[r.status]) return res.status(r.status).json({erro:erros[r.status]});
  } catch {
    return res.status(502).json({erro:"mesas_indisponiveis"});
  }
  return res.status(502).json({erro:"mesas_indisponiveis"});
}
