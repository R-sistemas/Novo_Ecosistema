import { entrar, listar, solicitar } from "../../supabase-pdv.mjs";

export { entrar };

export async function lojasDoGestor() {
  const vinculos = await listar("membros?select=empresas(id,nome)&papel=eq.gestor");
  return vinculos.map(v => v.empresas).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function rota(caminho, empresa, cursor) {
  const consulta = new URLSearchParams({ empresa_id: empresa });
  if (cursor) consulta.set("cursor", cursor);
  return "/api/" + caminho + "?" + consulta;
}

export const verificarLoja = empresa => solicitar(rota("painel-sessao", empresa), undefined, "GET", "");
export const consultarProdutos = (empresa, cursor) => solicitar(rota("painel-catalogo", empresa, cursor), undefined, "GET", "");
export const gravarProduto = (empresa, produto_id, dados) =>
  solicitar(rota("painel-catalogo", empresa), { produto_id, dados }, "POST", "");
