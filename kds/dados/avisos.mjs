import { executar } from "../../supabase-pdv.mjs";

export const enviarAvisoPedido = (empresa,pedido,mensagem) => executar("enviar_aviso_pedido", {
  p_empresa:empresa,p_pedido:pedido,p_mensagem:mensagem
});
