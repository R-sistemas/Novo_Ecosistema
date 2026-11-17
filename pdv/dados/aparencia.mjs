import { executar } from "../../supabase-pdv.mjs";

export const salvarAparencia = (dados) => executar("configurar_aparencia_cardapio", dados);
