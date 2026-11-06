import { integracaoQuiosque, pedidoValido } from "../lib/asaas-quiosque.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const integracao = integracaoQuiosque();
  if (!integracao) return res.status(503).json({ erro: "Pix indisponível." });
  const { banco, asaas } = integracao;
  const { p_slug, p_id, p_cliente = null, p_mesa = null, p_itens, cpfCnpj } = req.body ?? {};
  if (p_slug !== "quiosque-dorafa" || !pedidoValido(p_id) || !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido inválido." });
  }
  const documento = typeof cpfCnpj === "string" ? cpfCnpj.replace(/[.\/-]/g, "") : "";
  if (p_itens.length && !/^(\d{11}|\d{14})$/.test(documento)) {
    return res.status(400).json({ erro: "Informe o CPF ou CNPJ para gerar o Pix." });
  }

  try {
    const ativo = await banco("pix_online_disponivel", { p_slug });
    if (!ativo) return res.status(503).json({ erro: "Pix indisponível." });
    const pedido = await banco("reservar_pix_quiosque", { p_id, p_cliente, p_mesa, p_itens });
    if (pedido.confirmado) return res.status(200).json({ aguardaConfirmacao: true });
    let cobranca;
    if (pedido.cobranca) {
      cobranca = await asaas("/payments/" + encodeURIComponent(pedido.cobranca));
    } else {
      const existentes = await asaas("/payments?externalReference=" + encodeURIComponent(p_id));
      cobranca = existentes.data?.[0];
      if (!cobranca && pedido.criar) {
        const clientes = await asaas("/customers?limit=1&cpfCnpj=" + encodeURIComponent(documento));
        const cliente = clientes.data?.[0] ?? await asaas("/customers", {
          name: p_cliente.trim(), cpfCnpj: documento, notificationDisabled: true
        });
        cobranca = await asaas("/payments", {
          customer: cliente.id, billingType: "PIX", value: pedido.total_centavos / 100,
          dueDate: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()),
          description: "Pedido Quiosque Do’Rafa", externalReference: p_id
        });
      }
      if (!cobranca) return res.status(409).json({ erro: "Cobrança ainda indisponível." });
      if (cobranca.externalReference !== p_id || cobranca.billingType !== "PIX" ||
          Math.round(cobranca.value * 100) !== pedido.total_centavos ||
          !/^pay_[a-z0-9]+$/i.test(cobranca.id)) throw new Error("Cobrança divergente.");
      const vinculado = await banco("atualizar_pix_quiosque", {
        p_pedido: p_id, p_cobranca: cobranca.id, p_valor: pedido.total_centavos, p_confirmado: false
      });
      if (!vinculado) throw new Error("Vínculo recusado.");
    }
    if (["RECEIVED", "CONFIRMED"].includes(cobranca.status)) {
      return res.status(200).json({ aguardaConfirmacao: true });
    }
    if (cobranca.deleted || cobranca.status !== "PENDING") {
      return res.status(409).json({ erro: "Cobrança indisponível para pagamento." });
    }
    const pix = await asaas("/payments/" + encodeURIComponent(cobranca.id) + "/pixQrCode");
    return res.status(200).json({ imagem: pix.encodedImage, copiaECola: pix.payload, expiraEm: pix.expirationDate });
  } catch (erro) {
    console.error("Checkout Pix Quiosque", erro.message);
    return res.status(502).json({ erro: "Não foi possível gerar o Pix deste pedido." });
  }
}
