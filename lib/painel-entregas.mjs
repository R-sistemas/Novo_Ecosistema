import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { bearer } from "./cadastro-operador.mjs";
import { instante } from "./painel-pedidos.mjs";

const erros = {400:"filtros_invalidos",401:"sessao_invalida",403:"acesso_negado",404:"entrega_indisponivel"};
const idValido = id => typeof id === "string" && uuid.test(id);
const texto = (v,n) => v === undefined || (typeof v === "string" && v.length <= n);

export async function painelEntregas(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow","GET");
    return res.status(405).end();
  }
  const token = req.headers.authorization;
  if (!bearer(token)) return res.status(401).json({erro:erros[401]});
  const {empresa_id,entrega_id,inicio,fim,estado,busca,cursor_data,cursor_id,limite} = req.query ?? {};
  if (!idValido(empresa_id) || (entrega_id !== undefined && !idValido(entrega_id)) ||
      [inicio,fim,cursor_data].some(v => v !== undefined && !instante(v)) ||
      (cursor_id !== undefined && !idValido(cursor_id)) || !texto(estado,12) || !texto(busca,36) ||
      (limite !== undefined && (typeof limite !== "string" || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limite)))) {
    return res.status(400).json({erro:erros[400]});
  }
  const chamar = chamarSupabasePainel(token);
  if (!chamar) return res.status(503).json({erro:"entregas_indisponiveis"});
  const p_dados = entrega_id ? {id:entrega_id} :
    {inicio,fim,estado,busca,cursor_data,cursor_id,limite:limite === undefined ? undefined : Number(limite)};
  try {
    const resposta = await chamar("/rest/v1/rpc/painel_entregas",{
      method:"POST",body:JSON.stringify({p_empresa:empresa_id,p_acao:entrega_id ? "detalhe" : "listar",p_dados})
    });
    if (resposta.ok) return res.status(200).json(await resposta.json());
    if (erros[resposta.status]) return res.status(resposta.status).json({erro:erros[resposta.status]});
  } catch { /* falha de transporte */ }
  return res.status(502).json({erro:"entregas_indisponiveis"});
}
