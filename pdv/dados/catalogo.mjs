import { solicitar } from "../../supabase-pdv.mjs";

export function cadastrarProduto(dados) {
  return solicitar("/rest/v1/produtos", dados);
}

export function atualizarProduto(empresa, id, dados) {
  const caminho = "/rest/v1/produtos?empresa_id=eq." + empresa + "&id=eq." + id;
  return solicitar(caminho, dados, "PATCH");
}
