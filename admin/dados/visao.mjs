import { solicitar } from "../../supabase-pdv.mjs";

export const consultarVisao = (empresa,{inicio,fim}) => solicitar(
  "/api/painel-visao?" + new URLSearchParams({empresa_id:empresa,inicio,fim}),undefined,"GET",""
);
