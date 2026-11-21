import { uuid, chamarSupabasePainel } from "./painel-sessao.mjs";
import { bearer } from "./cadastro-operador.mjs";
import { periodoFinanceiroValido } from "../admin/regras/financeiro.mjs";

const erros = {400:"filtros_invalidos",401:"sessao_invalida",403:"acesso_negado"};

export async function painelFinanceiro(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const authorization = req.headers.authorization;
  if (!bearer(authorization)) return res.status(401).json({ erro: erros[401] });
  const { empresa_id, acao, inicio, fim, pagina = "1" } = req.query ?? {};
  const paginada = acao === "extrato" || acao === "conciliacao";
  if (typeof empresa_id !== "string" || !uuid.test(empresa_id) || !["resumo", "extrato", "conciliacao", "exportar"].includes(acao) ||
    !periodoFinanceiroValido(inicio, fim, acao === "conciliacao" ? 365 : 366) ||
    (paginada && (typeof pagina !== "string" || !/^[1-9]\d{0,9}$/.test(pagina) || Number(pagina) > 2147483647))) {
    return res.status(400).json({ erro: erros[400] });
  }

  // A sessão de gestor e a empresa são verificadas dentro de cada RPC.
  const chamar = chamarSupabasePainel(authorization);
  if (!chamar) return res.status(503).json({ erro: "financeiro_indisponivel" });
  const parametros = { p_empresa: empresa_id, p_inicio: inicio, p_fim: fim };
  if (paginada) Object.assign(parametros, { p_pagina: Number(pagina), p_tamanho: 25 });
  try {
    const resposta = await chamar("/rest/v1/rpc/painel_financeiro_" + acao, {
      method: "POST", body: JSON.stringify(parametros)
    });
    if (resposta.ok) return res.status(200).json(await resposta.json());
    if (erros[resposta.status]) return res.status(resposta.status).json({ erro: erros[resposta.status] });
  } catch { /* falha de transporte */ }
  return res.status(502).json({ erro: "financeiro_indisponivel" });
}
