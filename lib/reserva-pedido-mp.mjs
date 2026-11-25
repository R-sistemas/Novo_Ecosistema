import { bancoMercadoPagoTeste as banco } from "./banco-mercado-pago-teste.mjs";
import { decifrarCredencialMP } from "./cofre-mercado-pago.mjs";


export function abrirCredencialMP(registro) {
  const segredos = decifrarCredencialMP(registro.envelope, registro);
  const atual = registro.estado !== "pendente" && registro.envelope_atual ? decifrarCredencialMP(registro.envelope_atual, registro) : segredos;
  return { token: atual.access_token, segredo: segredos.webhook_secret, integracao: registro.integracao, recebedor: registro.recebedor };
}

export async function reservarPedidoMP(dados, { sandbox, meio, token }) {
  const reserva = await banco("servico_mp_reserva_pedido", {
    ...dados, p_ambiente: sandbox ? "sandbox" : "producao", p_meio: meio, p_legado: Boolean(token)
  });
  if (!reserva || reserva.bloqueada) return null;
  if (reserva.legado) return token ? { pedido: reserva.pedido, token } : null;
  return { pedido: reserva, ...abrirCredencialMP(reserva) };
}

export function vincularOrdemMP(integracao, ambiente, meio, pedido, ordem, valor, confirmado = false) {
  const dados = { p_pedido: pedido, p_valor: valor, p_confirmado: confirmado };
  return integracao
    ? banco("servico_mp_vincular_ordem", { ...dados, p_integracao: integracao, p_ordem: ordem, p_meio: meio })
    : banco("atualizar_" + meio + "_mercado_pago_" + ambiente, { ...dados, p_cobranca: ordem });
}
