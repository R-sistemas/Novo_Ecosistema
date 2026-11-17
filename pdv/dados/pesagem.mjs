import { executar } from "../../supabase-pdv.mjs";

export const ajustarItemPesado = (dados) => executar("ajustar_item_pesado", dados);
