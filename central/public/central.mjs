import { autenticar } from "./interface/acesso.mjs";
import { inventario } from "./interface/inventario.mjs";

const painel = inventario(() => acesso.sair("Sua sessão terminou ou o acesso foi revogado."));
const acesso = autenticar(painel.abrir, painel.fechar);
