import { timingSafeEqual } from "node:crypto";
import { enderecoValido, mapaDoEndereco } from "./frete-remo.mjs";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const etapas = { ATRIBUIDO: "aceita", EM_ROTA: "em_rota", ENTREGUE: "entregue" };

function chamarRpc(nome, corpo, autorizacao) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  return fetch(new URL("/rest/v1/rpc/" + nome, SUPABASE_URL), {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: autorizacao ?? "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(6000)
  });
}

function autorizadoWebhook(authorization) {
  const segredo = process.env.CARDAPIO_WEBHOOK_SECRET;
  if (!segredo || typeof authorization !== "string") return false;
  const esperado = Buffer.from("Bearer " + segredo);
  const recebido = Buffer.from(authorization);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export async function atualizarDespachoRemo(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  if (!autorizadoWebhook(req.headers.authorization)) return res.status(401).end();
  const { solicitacao_id, ordem_uuid, status } = req.body ?? {};
  if (!uuid.test(solicitacao_id) || !uuid.test(ordem_uuid)) return res.status(200).json({ ignorado: true });
  if (!Object.hasOwn(etapas, status)) return res.status(200).json({ ignorado: true });
  try {
    const resposta = await chamarRpc("atualizar_despacho_integrado", {
      p_pedido: solicitacao_id, p_ordem: ordem_uuid, p_estado: etapas[status]
    });
    if (!resposta.ok) return res.status(503).end();
    return res.status(200).json({ ok: await resposta.json() });
  } catch {
    return res.status(503).end();
  }
}

export async function despacharRemo(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const sessao = req.headers.authorization;
  if (typeof sessao !== "string" || !/^Bearer \S+$/.test(sessao)) {
    return res.status(401).json({ erro: "Entre no PDV para solicitar despacho." });
  }
  const { pedido } = req.body ?? {};
  if (typeof pedido !== "string" || !uuid.test(pedido)) {
    return res.status(400).json({ erro: "Pedido inválido." });
  }
  const dados = { p_pedido: pedido };
  const { REMO_API_URL, REMO_API_KEY } = process.env;
  if (!REMO_API_URL || !REMO_API_KEY) return res.status(503).json({ erro: "Integração REMO indisponível." });
  try {
    const preparo = await chamarRpc("preparar_despacho_integrado", dados, sessao);
    const pedidoPronto = await preparo.json().catch(() => null);
    if (!preparo.ok) {
      if (preparo.status === 401) return res.status(401).json({ erro: "Entre novamente no PDV." });
      if (preparo.status === 403) return res.status(403).json({ erro: "Pedido indisponível para despacho." });
      return res.status(409).json({ erro: pedidoPronto?.code === "P0001" ? pedidoPronto.message : "Confira se o pedido está pronto para despacho." });
    }
    if (pedidoPronto?.ja_solicitado) return res.status(200).json({ ok: true });
    if (pedidoPronto?.ambiente === "sandbox") {
      const teste = await chamarRpc("solicitar_despacho_remo", dados, sessao);
      return teste.ok ? res.status(200).json({ ok: true }) : res.status(409).json({ erro: "Não foi possível despachar o pedido de teste." });
    }
    if (pedidoPronto?.ambiente !== "producao") throw new Error("pedido_invalido");
    const cancelarTentativa = async () => {
      const registro = await chamarRpc("registrar_despacho_integrado", {
        ...dados, p_ordem: null, p_saldo_insuficiente: false
      });
      if (!registro.ok) throw new Error("registro_despacho");
    };
    if (!enderecoValido(pedidoPronto.endereco)) {
      await cancelarTentativa();
      return res.status(422).json({ erro: "Confira o endereço da entrega antes de solicitar o despacho." });
    }
    const mapa = mapaDoEndereco(pedidoPronto.endereco);
    const resposta = await fetch(new URL("/api/v1/ordens", REMO_API_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": REMO_API_KEY },
      body: JSON.stringify({
        r_sistemas_id: pedidoPronto.empresa,
        solicitacao_id: pedido,
        idempotency_key: "r-sistemas:" + pedido,
        client_maps_url: mapa,
        payload: {
          origem: "R_SISTEMAS",
          cliente_nome: pedidoPronto.cliente,
          cliente_endereco: [
            pedidoPronto.endereco.logradouro, pedidoPronto.endereco.numero, pedidoPronto.endereco.bairro,
            pedidoPronto.endereco.cidade, pedidoPronto.endereco.complemento
          ].filter(Boolean).join(", "),
          cobrar_na_entrega_centavos: pedidoPronto.cobrar_centavos
        }
      }),
      signal: AbortSignal.timeout(18000)
    });
    const ordem = await resposta.json().catch(() => null);
    const saldoInsuficiente = resposta.status === 402 && ordem?.error === "saldo_insuficiente";
    if (saldoInsuficiente || (resposta.ok && uuid.test(ordem?.uuid))) {
      const registro = await chamarRpc("registrar_despacho_integrado", {
        ...dados, p_ordem: saldoInsuficiente ? null : ordem.uuid
      });
      if (!registro.ok) throw new Error("registro_despacho");
      if (saldoInsuficiente) {
        return res.status(402).json({ erro: "Saldo insuficiente na REMO. Recarregue a carteira e solicite o despacho novamente." });
      }
      if (Object.hasOwn(etapas, ordem.status)) {
        await chamarRpc("atualizar_despacho_integrado", {
          ...dados, p_ordem: ordem.uuid, p_estado: etapas[ordem.status]
        });
      }
      return res.status(200).json({ ok: true });
    }
    if (ordem?.error === "frete_indisponivel") {
      await cancelarTentativa();
      return res.status(422).json({ erro: "A REMO não conseguiu calcular o frete para este endereço." });
    }
    if (ordem?.error === "parceira_nao_vinculada") {
      await cancelarTentativa();
      return res.status(422).json({ erro: "Esta loja ainda não está vinculada à REMO." });
    }
  } catch {
    // A referência fixa permite recuperar o mesmo despacho em uma nova tentativa.
  }
  return res.status(502).json({ erro: "Não foi possível confirmar o despacho. Tente novamente pelo mesmo pedido." });
}
