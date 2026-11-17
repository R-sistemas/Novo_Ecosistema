import { executar } from "../../supabase-pdv.mjs";

export const abrirCaixa = (dados) => executar("abrir_caixa", dados);
export const fecharCaixa = (dados) => executar("fechar_caixa", dados);
export const movimentarCaixa = (dados) => executar("movimentar_caixa", dados);

export const listarAcertos = (empresa) => executar("acertos_entrega_pendentes", { p_empresa: empresa });
export const confirmarAcerto = (dados) => executar("confirmar_acerto_entrega", dados);

export const listarRecebimentosOnline = (empresa, dia) =>
  executar("recebimentos_online_da_loja", { p_empresa: empresa, p_dia: dia });
