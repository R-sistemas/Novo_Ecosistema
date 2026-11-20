import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { bearer } from "./cadastro-operador.mjs";

const erros = {400:"filtros_invalidos",401:"sessao_invalida",403:"acesso_negado",404:"pedido_indisponivel"};
const idValido = id => typeof id === "string" && uuid.test(id);
const instante = valor => typeof valor === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(valor) &&
  Number.isFinite(Date.parse(valor));

export async function painelPedidos(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow","GET");
    return res.status(405).end();
  }
  const token = req.headers.authorization;
  if (!bearer(token)) return res.status(401).json({erro:erros[401]});
  const {empresa_id, pedido_id, inicio, fim, estado, origem, cursor_data, cursor_id, limite} = req.query ?? {};
  if (!idValido(empresa_id) || (pedido_id !== undefined && !idValido(pedido_id)) ||
      [inicio,fim,cursor_data].some(v => v !== undefined && !instante(v)) ||
      (cursor_id !== undefined && !idValido(cursor_id)) ||
      [estado,origem].some(v => v !== undefined && (typeof v !== "string" || v.length > 12)) ||
      (limite !== undefined && (typeof limite !== "string" || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limite)))) {
    return res.status(400).json({erro:erros[400]});
  }
  const chamar = chamarSupabasePainel(token);
  if (!chamar) return res.status(503).json({erro:"pedidos_indisponiveis"});

  const rpc = pedido_id ? "painel_detalhe_pedido" : "painel_listar_pedidos";
  const dados = pedido_id ? {p_empresa:empresa_id,p_pedido:pedido_id} : {
    p_empresa:empresa_id,p_inicio:inicio,p_fim:fim,p_estado:estado,p_origem:origem,
    p_cursor_data:cursor_data,p_cursor_id:cursor_id,p_limite:limite === undefined ? undefined : Number(limite)
  };
  try {
    const resposta = await chamar("/rest/v1/rpc/" + rpc,{method:"POST",body:JSON.stringify(dados)});
    if (resposta.ok) return res.status(200).json(await resposta.json());
    if (erros[resposta.status]) return res.status(resposta.status).json({erro:erros[resposta.status]});
  } catch {
    return res.status(502).json({erro:"pedidos_indisponiveis"});
  }
  return res.status(502).json({erro:"pedidos_indisponiveis"});
}
