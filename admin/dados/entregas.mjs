import { solicitar } from "../../supabase-pdv.mjs";

const consultar = (empresa,parametros) => solicitar(
  "/api/painel-entregas?" + new URLSearchParams({empresa_id:empresa,...parametros}),undefined,"GET",""
);
export const listarEntregas = (empresa,filtros,cursor) => consultar(empresa,{
  ...filtros,...(cursor && {cursor_data:cursor.data,cursor_id:cursor.id})
});
export const detalharEntrega = (empresa,id) => consultar(empresa,{entrega_id:id});
