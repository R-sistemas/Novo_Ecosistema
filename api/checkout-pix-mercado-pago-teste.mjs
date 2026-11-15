import { emailPixMercadoPago, mercadoPago } from "../lib/mercado-pago.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";
import { cotarFreteRemo, enderecoValido, enderecoLegadoValido } from "../lib/frete-remo.mjs";

export async function checkout(req, res, { sandbox, token }) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const { p_slug, p_id, p_cliente = null, p_mesa = null, p_itens, endereco, pagamento, frete_centavos: freteInformado } = req.body ?? {};
  if (p_slug !== (sandbox ? "loja-teste" : "quiosque-dorafa") || typeof p_id !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p_id) ||
      !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido inválido." });
  }
  if (pagamento !== undefined && (!endereco || p_mesa || !["online", "na_entrega"].includes(pagamento))) {
    return res.status(400).json({ erro: "Confira os dados da entrega." });
  }
  const enderecoAceito = enderecoValido(endereco) || (sandbox && enderecoLegadoValido(endereco));
  if (pagamento !== undefined && (!enderecoAceito || !Number.isSafeInteger(freteInformado) || freteInformado < 0)) {
    return res.status(400).json({ erro: "Confira o endereço e a cotação da entrega." });
  }
  if (pagamento !== undefined && !sandbox && (!/^\d{10,11}$/.test(endereco.telefone || "") ||
      (pagamento === "online" && endereco.metodo_pagamento !== "pix") ||
      (pagamento === "na_entrega" && !["dinheiro", "maquininha"].includes(endereco.metodo_pagamento)))) {
    return res.status(400).json({ erro: "Confira o contato e a forma de pagamento." });
  }
  const naEntrega = pagamento === "na_entrega";
  if (!naEntrega && !token) return res.status(503).json({ erro: "Pix indisponível." });
  try {
    let freteCentavos = 0;
    if (pagamento !== undefined) {
      freteCentavos = await cotarFreteRemo(p_slug, endereco);
      if (freteCentavos !== freteInformado) {
        return res.status(409).json({ erro: "O valor da entrega mudou. Confira a nova cotação antes de confirmar.", frete_centavos: freteCentavos });
      }
    }
    if (naEntrega) {
      const id = await banco("enviar_pedido_pagamento_na_entrega_com_frete", {
        p_slug, p_id, p_cliente, p_itens, p_endereco: endereco, p_frete_centavos: freteCentavos
      });
      return res.status(200).json({ pedido: id });
    }
    const ambiente = sandbox ? "teste" : "quiosque";
    const pedido = pagamento === "online"
      ? await banco("reservar_pix_entrega_frete_" + ambiente, { p_id, p_cliente, p_itens, p_endereco: endereco, p_frete_centavos: freteCentavos })
      : await banco("reservar_pix_mercado_pago_" + ambiente, { p_id, p_cliente, p_mesa, p_itens });
    const cliente = mercadoPago(token);
    if (sandbox && pedido.cobranca) return res.status(200).json({ aguardaConfirmacao: true });
    const ordem = pedido.cobranca ? await cliente.consultarOrdem(pedido.cobranca)
      : await cliente.criarPix({
        pedidoId: p_id, totalCentavos: pedido.total_centavos,
        email: emailPixMercadoPago(sandbox),
        pagadorTeste: sandbox ? { first_name: "APRO" } : undefined
      });
    if (!/^ORD[A-Z0-9]+$/.test(ordem.id) || /^ORDTST/.test(ordem.id) !== sandbox ||
        ordem.external_reference !== p_id || ordem.total_amount !== (pedido.total_centavos / 100).toFixed(2)) {
      throw new Error("Ordem divergente.");
    }
    if (!pedido.cobranca) {
      const vinculada = await banco("atualizar_pix_mercado_pago_" + ambiente, {
        p_pedido: p_id, p_cobranca: ordem.id, p_valor: pedido.total_centavos, p_confirmado: false
      });
      if (!vinculada) throw new Error("Vínculo da ordem recusado.");
    }
    if (sandbox || ordem.status === "processed") return res.status(200).json({ aguardaConfirmacao: true });
    const metodo = ordem.transactions?.payments?.[0]?.payment_method;
    if (ordem.status !== "action_required" || metodo?.id !== "pix" ||
        !metodo.qr_code_base64 || !metodo.qr_code) {
      return res.status(409).json({ erro: "QR Code indisponível para esta cobrança." });
    }
    return res.status(200).json({ imagem: metodo.qr_code_base64, copiaECola: metodo.qr_code });
  } catch (erro) {
    console.error("Checkout Mercado Pago", erro.message);
    return res.status(502).json({ erro: "Não foi possível preparar o Pix." });
  }
}

async function cotarFrete(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const { p_slug, endereco } = req.body ?? {};
  if (!(enderecoValido(endereco) || (p_slug === "loja-teste" && enderecoLegadoValido(endereco)))) {
    return res.status(400).json({ erro: "Confira o endereço da entrega." });
  }
  try {
    const frete_centavos = await cotarFreteRemo(p_slug, endereco);
    return res.status(200).json({ frete_centavos });
  } catch (erro) {
    return res.status(erro.status || 502).json({ erro: erro.message || "Cotação indisponível." });
  }
}

export default function handler(req, res) {
  if (new URL(req.url || "/", "http://localhost").searchParams.get("cotacao_frete") === "1") {
    return cotarFrete(req, res);
  }
  return checkout(req, res, { sandbox: true, token: process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN });
}
