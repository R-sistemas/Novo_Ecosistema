import { solicitar } from "../../supabase-pdv.mjs";

const consultar = (empresa, parametros) => solicitar(
  "/api/painel-pedidos?" + new URLSearchParams({empresa_id:empresa,...parametros}),undefined,"GET",""
);
export const listarPedidos = (empresa,filtros,cursor) => consultar(empresa,{
  ...filtros,...(cursor && {cursor_data:cursor.data,cursor_id:cursor.id})
});
export const detalharPedido = (empresa,id) => consultar(empresa,{pedido_id:id});
