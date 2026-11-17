import { executar } from "../../supabase-pdv.mjs";

export const listarAcertos = (empresa) => executar("acertos_entrega_pendentes", { p_empresa: empresa });
export const confirmarAcerto = (dados) => executar("confirmar_acerto_entrega", dados);
