import { executar } from "../../supabase-pdv.mjs";

export const consultarProntos = loja => executar("pedidos_prontos_retirada",{p_slug:loja});
