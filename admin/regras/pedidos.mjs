import { estadosEntrega } from "../../estado-entrega.mjs";
import { paraReais } from "../../pdv/regras/moeda.mjs";

const moeda = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const dataHora = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"});
export const valor = centavos => centavos == null ? "—" : moeda.format(paraReais(Number(centavos)));
export const horario = data => dataHora.format(new Date(data));
export const origens = {cardapio:"Cardápio",entrega:"Entrega"};
export const estados = {novo:"Novo",preparo:"Preparo",pronto:"Pronto",entregue:"Entregue no KDS",recusado:"Recusado",cancelado:"Cancelado"};
export const estadoLogistico = estado => Object.hasOwn(estadosEntrega,estado)
  ? estadosEntrega[estado] : estado === "saldo_insuficiente" ? "Saldo insuficiente" : estado || "—";
const pagamentos = {confirmado:"Confirmado",pendente:"Pendente",na_entrega:"Na entrega",sem_confirmacao:"Sem confirmação"};
const meios = {pix:"Pix",credito:"Crédito",debito:"Débito",cartao:"Cartão",dinheiro:"Dinheiro"};
export const pagamento = pedido => [pagamentos[pedido.pagamento_estado],meios[pedido.pagamento_meio] || pedido.pagamento_meio]
  .filter(Boolean).join(" · ");
export const identificacao = pedido => pedido.comanda == null ? pedido.id : "Comanda " + pedido.comanda;
export const itemResumo = item => (item.quantidade ?? "—") + " × " + (item.nome || "Item");

function diaLocal(dia,incremento) {
  const [ano,mes,data] = dia.split("-").map(Number);
  const instante = new Date(0);
  instante.setHours(0,0,0,0);
  instante.setFullYear(ano,mes-1,data+incremento);
  return instante.toISOString();
}

export function filtrosPedidos({inicio,fim,estado,origem}) {
  if (inicio && fim && inicio > fim) throw new Error("A data inicial deve ser anterior ou igual à final.");
  return Object.fromEntries(Object.entries({
    inicio:inicio ? diaLocal(inicio,0) : "",
    fim:fim ? diaLocal(fim,1) : "",
    estado,origem
  }).filter(([,v]) => v));
}

export function buscarNaPagina(pedidos,busca) {
  const normalizar = texto => String(texto ?? "").normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
  const termo = normalizar(busca).trim();
  return pedidos.filter(p => [p.id,p.cliente,p.comanda].some(v => normalizar(v).includes(termo)));
}
