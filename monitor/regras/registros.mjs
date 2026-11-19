import { estadosEntrega } from "../../estado-entrega.mjs";
export const hora = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" });
export const formatarDia = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const estados = { novo: "Novo", preparo: "Em preparo", pronto: "Pronto", entregue: "Entregue", recusado: "Encerrado" };
const pagamentos = {
  recebido: "Pago", encerrado: "Encerrado", teste: "Pagamento de teste",
  aguardando_online: "Aguardando confirmação online", na_entrega: "Pagamento na entrega", no_caixa: "A receber no caixa"
};
const meios = { pix: "Pix", dinheiro: "Dinheiro", credito: "Crédito", debito: "Débito", cartao: "Cartão" };
export const abas = { pedidos: "Pedidos", recebimentos: "Recebimentos", entregas: "Entregas" };

export function descreverRegistro(registro, aba) {
  if (aba === "recebimentos") {
    const origem = registro.origem === "caixa" ? "Caixa" : "Online";
    const titulo = registro.comanda ? `Pedido #${registro.comanda} · ${meios[registro.meio]}` : `Venda · ${meios[registro.meio]}`;
    return { titulo: titulo, descricao: `${origem} · ${hora.format(new Date(registro.recebido_em))}`, valor: registro.valor };
  }
  const destino = registro.mesa ? `Mesa ${registro.mesa}` : registro.entrega ? "Entrega" : "Retirada";
  const etapa = aba === "entregas" ? estadosEntrega[registro.entrega] : estados[registro.estado];
  return { titulo: `Pedido #${registro.comanda} · ${destino}`, descricao: `${etapa} · ${pagamentos[registro.pagamento]} · ${hora.format(new Date(registro.criado_em))}`, valor: registro.total_centavos };
}
