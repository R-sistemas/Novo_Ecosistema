import { executar } from "../../supabase-pdv.mjs";

export const abrirCaixa = (dados) => executar("abrir_caixa", dados);
export const fecharCaixa = (dados) => executar("fechar_caixa", dados);
export const movimentarCaixa = (dados) => executar("movimentar_caixa", dados);
