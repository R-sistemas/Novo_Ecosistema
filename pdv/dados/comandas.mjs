import { executar } from "../../supabase-pdv.mjs";

export const registrarRecebimento = (dados) => executar("receber_comanda_conferida", dados);
export const listarComandas = (dados) => executar("comandas_pendentes", dados);
