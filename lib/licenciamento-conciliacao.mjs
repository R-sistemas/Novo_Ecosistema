import { bancoMercadoPagoTeste as servico } from "./banco-mercado-pago-teste.mjs";
import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { adaptador, confirmar, provarConta, provarOrdem } from "./licenciamento-ordens.mjs";

async function localizar(mp, recebedor, c) {
  if (c.recurso) return provarOrdem(await mp.consultarOrdem(c.recurso),recebedor,c.recurso,c.id);
  const fim = Date.now();
  const inicio = Math.max(Date.parse(c.criado_em)-60000,fim-29*86400000);
  if (!Number.isFinite(inicio) || inicio>=fim) throw new Error("Janela de consulta inválida");
  const resultado = await mp.buscarOrdens(c.id,new Date(inicio).toISOString(),new Date(fim).toISOString());
  if (!Array.isArray(resultado.data)) throw new Error("Resultado indisponível");
  const exatas = resultado.data.filter(o => o.external_reference === c.id);
  if (exatas.length>1 || Number(resultado.paging?.total) > resultado.data.length) throw new Error("Ordens ambíguas");
  if (!exatas.length) return null;
  const id = provarOrdem(exatas[0],recebedor,exatas[0].id,c.id).id;
  return provarOrdem(await mp.consultarOrdem(id),recebedor,id,c.id);
}

export async function conciliarCobranca(mp,recebedor,c) {
  const ordem = await localizar(mp,recebedor,c);
  if (!ordem) return null;
  const estado = await confirmar(ordem,recebedor);
  if (estado === "ignorado") throw new Error("Ordem não correlacionada à cobrança");
  return {estado, pix:estado==="pendente" && c.meio==="pix" ? ordem.transactions?.payments?.[0]?.payment_method?.qr_code ?? null : null};
}

export async function conciliarFila(recebedor, cliente) {
  const c = await servico("servico_licenca_puxar_conciliacao",{p_recebedor:recebedor});
  if (!c) return 0;
  let observada = false;
  try {
    observada = Boolean(await conciliarCobranca(await cliente(),recebedor,c));
    return Number(observada);
  } finally {
    await servico("servico_licenca_fechar_conciliacao",{p_id:c.id,p_lease:c.consulta_lease,p_observada:observada});
  }
}

export async function consultarCobrancaLicenca(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "POST") return res.status(405).end();
  const {empresa,cobranca} = req.body ?? {};
  if (![empresa,cobranca].every(x=>typeof x==="string" && uuid.test(x))) return res.status(400).end();
  const token = req.headers.authorization;
  if (!/^Bearer [\w.-]+$/.test(token ?? "")) return res.status(401).end();
  try {
    const chamar = chamarSupabasePainel(token);
    if (!chamar) return res.status(503).end();
    const sessao = await chamar("/auth/v1/user");
    if (!sessao.ok) return res.status(sessao.status < 500 ? 401 : 503).end();
    const {id:gestor} = await sessao.json();
    if (!uuid.test(gestor ?? "")) return res.status(401).end();
    const {mp,recebedor} = adaptador();
    const c = await servico("servico_licenca_ler_cobranca",{p_empresa:empresa,p_gestor:gestor,p_id:cobranca,p_recebedor:recebedor});
    if (!c) return res.status(404).end();
    await provarConta(mp,recebedor);
    const resultado = await conciliarCobranca(mp,recebedor,c);
    return res.status(200).json(resultado ?? {estado:c.estado,pix:null});
  } catch { return res.status(503).end(); }
}
