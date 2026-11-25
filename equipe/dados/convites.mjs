import { executar } from "../../supabase-pdv.mjs";

export const listarConvites = empresa => executar("gerenciar_convites_equipe", {
  p_empresa: empresa, p_acao: "listar", p_dados: {}
});

export const gerenciarConvites = (empresa, acao, dados) => executar("gerenciar_convites_equipe", {
  p_empresa: empresa, p_acao: acao, p_dados: dados
});

export const responderConvite = (token, acao) => executar("responder_convite_equipe", {
  p_token: token, p_acao: acao
});
