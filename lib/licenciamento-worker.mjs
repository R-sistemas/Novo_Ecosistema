import { timingSafeEqual } from "node:crypto";
import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { adaptador, provarConta } from "./licenciamento-ordens.mjs";
import { obterPixLicenca } from "./licenciamento-pagamentos.mjs";

import { conciliarFila } from "./licenciamento-conciliacao.mjs";

function servidorAutorizado(req) {
  const segredo = process.env.LICENCAS_MP_SANDBOX_WORKER_SECRET;
  const recebido = req.headers.authorization;
  if (!segredo || Buffer.byteLength(segredo) < 24 || typeof recebido !== "string") return false;
  const esperado = Buffer.from("Bearer " + segredo);
  const recebidoBytes = Buffer.from(recebido);
  return esperado.length === recebidoBytes.length && timingSafeEqual(esperado,recebidoBytes);
}

export async function licenciamentoWorker(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (!servidorAutorizado(req)) return res.status(401).end();
  try {
    const {mp,recebedor} = adaptador();
    const tarefa = await servico("servico_licenca_agendar_pix",{p_recebedor:recebedor});
    let validacao;
    const cliente = async () => {
      validacao ??= provarConta(mp,recebedor);
      await validacao;
      return mp;
    };
    const [emissao, conciliacao] = await Promise.allSettled([
      tarefa ? emitir(tarefa,recebedor,cliente) : 0,
      conciliarFila(recebedor,cliente)
    ]);
    const completo = emissao.status==="fulfilled" && conciliacao.status==="fulfilled";
    return res.status(completo?200:503).json({emitidas:emissao.value??0,conciliadas:conciliacao.value??0});
  } catch {
    return res.status(503).end();
  }
}

async function emitir(tarefa,recebedor,cliente) {
  let concluida = false;
  try {
    const resultado = await obterPixLicenca(tarefa.cobranca,await cliente(),recebedor);
    concluida = resultado.estado !== "ignorado";
  } finally {
    await servico("servico_licenca_fechar_agenda",{p_id:tarefa.id,p_lease:tarefa.lease,p_concluida:concluida});
  }
  if (!concluida) throw new Error("Emissão não correlacionada");
  return 1;
}
