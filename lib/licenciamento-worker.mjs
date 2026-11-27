import { timingSafeEqual } from "node:crypto";
import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { adaptador, provarConta } from "./licenciamento-ordens.mjs";
import { obterPixLicenca } from "./licenciamento-pagamentos.mjs";

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
    if (!tarefa) return res.status(200).json({emitidas:0});
    let concluida = false;
    try {
      await provarConta(mp,recebedor);
      const resultado = await obterPixLicenca(tarefa.cobranca,mp,recebedor);
      concluida = resultado.estado !== "ignorado";
    } finally {
      await servico("servico_licenca_fechar_agenda",{p_id:tarefa.id,p_lease:tarefa.lease,p_concluida:concluida});
    }
    return res.status(concluida?200:503).json({emitidas:Number(concluida)});
  } catch {
    return res.status(503).end();
  }
}
