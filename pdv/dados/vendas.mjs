import { executar, executarApi } from "../../supabase-pdv.mjs";

export const registrarVenda = (dados) => executar("registrar_venda_com_desconto", dados);

export function operarPixFrente(dados) {
  return executarApi("checkout-pix-mercado-pago-quiosque", {
    fluxo: "frente-caixa",
    ...dados,
  });
}
