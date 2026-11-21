import { solicitar } from "../../supabase-pdv.mjs";

export function consultarFinanceiro(empresa, acao, intervalo, pagina) {
  const parametros = new URLSearchParams({ empresa_id: empresa, acao, ...intervalo, pagina });
  return solicitar("/api/painel-financeiro?" + parametros, undefined, "GET", "");
}
