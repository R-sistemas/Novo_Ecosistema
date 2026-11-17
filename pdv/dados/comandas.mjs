import { executar } from "../../supabase-pdv.mjs";

export const registrarRecebimento = (dados) => executar("receber_comanda_conferida", dados);
export const listarComandas = (dados) => executar("comandas_pendentes", dados);

export const adicionarItens = (dados) => executar("adicionar_itens_comanda", dados);

export const ajustarItemPesado = (dados) => executar("ajustar_item_pesado", dados);

export const listarCancelamentos = (dados) => executar("comandas_para_cancelar", dados);
export const resolverCancelamento = (dados) => executar("resolver_cancelamento_comanda", dados);
export const solicitarCancelamento = (dados) => executar("solicitar_cancelamento_comanda", dados);
export const listarAjustesCaixa = (dados) => executar("ajustes_pendentes_caixa", dados);
export const resolverAjuste = (dados) => executar("resolver_ajuste_comanda", dados);
