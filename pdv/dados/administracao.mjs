import { executar, executarApi } from "../../supabase-pdv.mjs";

export const configurarMesa = (dados) => executar("configurar_mesa_cardapio", dados);
export const configurarNomePdv = (dados) => executar("configurar_nome_pdv", dados);
export const configurarEdicaoKds = (dados) => executar("configurar_edicao_kds", dados);
export const configurarTerminal = (dados) => executar("configurar_terminal_pdv", dados);
export const configurarPagamentoNaEntrega = (dados) => executar("configurar_pagamento_na_entrega", dados);

export const cadastrarOperador = (dados) => executarApi("cadastrar-operador", dados);

export const salvarAparencia = (dados) => executar("configurar_aparencia_cardapio", dados);

export const listarOperadores = (empresa) => executar("listar_operadores_gestor", { p_empresa: empresa });
export const removerOperador = (empresa, email) =>
  executar("remover_operador_loja", { p_empresa: empresa, p_email: email });
