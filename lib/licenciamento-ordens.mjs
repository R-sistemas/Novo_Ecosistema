import { createHash } from "node:crypto";
import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { contaDaOrdemMP, ordemNoAmbienteMP } from "./mercado-pago-ambiente.mjs";
import { mercadoPago } from "./mercado-pago.mjs";
import { uuid } from "./painel-sessao.mjs";

export function adaptador() {
  const { LICENCAS_MP_SANDBOX_TOKEN: token, LICENCAS_MP_SANDBOX_RECEBEDOR: recebedor,
    LICENCAS_MP_SANDBOX_WEBHOOK_SECRET: segredo } = process.env;
  if (!/^(TEST|APP_USR)-[a-z0-9_-]+$/i.test(token ?? "") || !/^\d+$/.test(recebedor ?? "")) {
    throw new Error("Adaptador sandbox indisponível");
  }
  return { mp: mercadoPago(token), recebedor, segredo };
}

const estados = new Map([
  ["processed:accredited","pago"],["processed:partially_refunded","parcial"],
  ["refunded:refunded","estornado"],["canceled:canceled","encerrado"],
  ["canceled:expired","encerrado"],["expired:expired","encerrado"],["failed:failed","encerrado"]
]);

export function centavos(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : null;
  return typeof valor === "string" && /^\d{1,8}\.\d{2}$/.test(valor) ? Number(valor.replace(".", "")) : null;
}

export function provarOrdem(ordem, recebedor, id = ordem?.id, chave = ordem?.external_reference) {
  if (!ordemNoAmbienteMP(ordem, true, recebedor) || String(contaDaOrdemMP(ordem) ?? "") !== recebedor ||
    !/^ORDTST[A-Z0-9]+$/.test(ordem.id) || ordem.id !== id ||
    !uuid.test(chave ?? "") || ordem.external_reference !== chave ||
    (ordem.currency_id ?? ordem.currency ?? "BRL") !== "BRL") throw new Error("Ordem fora do sandbox");
  return ordem;
}

export function condicoesCartao(p, base, total) {
  return {base,total,parcela:centavos(p.payment_method.installment_amount),
    vezes:p.payment_method.installments,bandeira:p.payment_method.id};
}

export async function confirmar(ordem, recebedor) {
  provarOrdem(ordem, recebedor);
  const pagamentos = ordem.transactions?.payments ?? [];
  const [p] = pagamentos;
  const valor = centavos(ordem.total_amount);
  const tipo = estados.get(ordem.status + ":" + ordem.status_detail) ?? "vinculo";
  if (valor === null || pagamentos.length > 1 || (p && centavos(p.amount) !== valor) ||
    (!p && !["vinculo","encerrado"].includes(tipo))) throw new Error("Ordem não correlacionada");
  const metodo = p?.payment_method;
  const meio = metodo?.id === "pix" ? "pix"
    : metodo?.type === "credit_card" || (!p && ordem.processing_mode === "manual") ? "cartao" : null;
  if (!meio || (tipo === "pago" && p.status !== "processed")) throw new Error("Meio não correlacionado");
  const pago = centavos(p?.paid_amount);
  if (tipo === "pago" && (pago === null || (meio === "pix" && pago !== valor))) {
    throw new Error("Valor não correlacionado");
  }
  const dados = meio === "cartao" && tipo === "pago" ? condicoesCartao(p, valor, pago) : {};
  const data = ordem.last_updated_date ?? ordem.created_date;
  if (!data || !Number.isFinite(Date.parse(data))) throw new Error("Ordem sem data");
  return servico("servico_licenca_observar_ordem", {
    p_id:ordem.external_reference,p_provedor:"mercado_pago",p_recebedor:recebedor,p_ambiente:"sandbox",
    p_recurso:ordem.id,p_valor:valor,p_evento:createHash("sha256").update(JSON.stringify([ordem.id,tipo,data])).digest("hex"),
    p_tipo:tipo,p_ocorrido:data,p_meio:meio,p_condicoes:dados
  });
}

export async function provarConta(mp, recebedor) {
  const conta = await mp.consultarConta();
  if (String(conta.id) !== recebedor || conta.country_id !== "BR" || !conta.tags?.includes("test_user")) {
    throw new Error("Recebedor fora do sandbox");
  }
}
