import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";
import { receberNotificacao } from "../lib/mercado-pago-webhook.mjs";
import { abrirCredencialMP } from "../lib/reserva-pedido-mp.mjs";
import { uuid } from "../lib/painel-sessao.mjs";

export default async function notificar(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const id = req.query?.integracao;
  if (typeof id !== "string" || !uuid.test(id)) return res.status(401).end();
  try {
    const registro = await banco("servico_integracao_mp_webhook", { p_integracao: id });
    if (!registro) return res.status(401).end();
    return await receberNotificacao(req, res, {
      ...abrirCredencialMP(registro), sandbox: registro.ambiente === "sandbox", recebedor: registro.recebedor, pendente: registro.estado === "pendente"
    });
  } catch {
    return res.status(502).end();
  }
}
