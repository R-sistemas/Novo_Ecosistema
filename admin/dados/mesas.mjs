import { solicitar } from "../../supabase-pdv.mjs";

const rota = empresa => "/api/painel-mesas?" + new URLSearchParams({empresa_id:empresa});
export const consultarMesas = empresa => solicitar(rota(empresa),undefined,"GET","");
export const gravarMesa = (empresa,dados) => solicitar(rota(empresa),dados,"POST","");
