import { executar } from "../../supabase-pdv.mjs";

export const listarOperadores = (empresa) => executar("listar_operadores_gestor", { p_empresa: empresa });
export const removerOperador = (empresa, email) =>
  executar("remover_operador_loja", { p_empresa: empresa, p_email: email });
