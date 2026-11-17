import { executar } from "../../supabase-pdv.mjs";

export const registrarVenda = (dados) => executar("registrar_venda_com_desconto", dados);
