import { solicitar } from "../../supabase-pdv.mjs";
import { consultarCardapio } from "../../cardapio/dados/pedidos.mjs";

const rota = empresa => "/api/painel-preferencias?" + new URLSearchParams({empresa_id:empresa});
export const consultarPreferencias = empresa => solicitar(rota(empresa),undefined,"GET","");
export const salvarPreferencias = (empresa,dados) => solicitar(rota(empresa),{dados},"POST","");
export const consultarVitrine = slug => consultarCardapio({p_slug:slug});
