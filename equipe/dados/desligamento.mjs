import { executar } from "../../supabase-pdv.mjs";

export const operarDesligamento = (empresa, acao, dados = {}) => executar("operar_desligamento_equipe", {
  p_empresa: empresa, p_acao: acao, p_dados: dados
});
