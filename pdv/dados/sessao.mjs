import { entrar, confirmarSenhaAtual, listar } from "../../supabase-pdv.mjs";

export { entrar, confirmarSenhaAtual };

export function carregarVinculosPdv() {
  return Promise.all([
    listar("empresas?select=id,nome&order=nome"),
    listar("membros?select=empresa_id&papel=eq.gestor"),
  ]);
}
