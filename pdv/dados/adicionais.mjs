import { executar } from "../../supabase-pdv.mjs";

export const adicionarItens = (dados) => executar("adicionar_itens_comanda", dados);
