const sandbox = "https://api-sandbox.asaas.com/v3";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const { ASAAS_SANDBOX_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!ASAAS_SANDBOX_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ erro: "Pix Sandbox indisponível." });
  }
  const { p_slug, p_id, p_cliente, p_mesa, p_itens } = req.body ?? {};
  if (p_slug !== "loja-teste" || typeof p_id !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(p_id) || !Array.isArray(p_itens) || p_itens.length > 30) {
    return res.status(400).json({ erro: "Pedido de teste inválido." });
  }

  async function chamar(url, headers, dados) {
    const resposta = await fetch(url, {
      method: dados === undefined ? "GET" : "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: dados === undefined ? undefined : JSON.stringify(dados),
      signal: AbortSignal.timeout(8000)
    });
    if (!resposta.ok) throw new Error("Integração retornou HTTP " + resposta.status);
    const corpo = await resposta.text();
    return corpo ? JSON.parse(corpo) : null;
  }
  const banco = (nome, dados) => chamar(new URL("/rest/v1/rpc/" + nome, SUPABASE_URL), {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY
  }, dados);
  const asaas = (rota, dados) => chamar(sandbox + rota, {
    access_token: ASAAS_SANDBOX_API_KEY,
    "User-Agent": "R-Sistemas-Sandbox/1.0"
  }, dados);

  try {
    const clientes = await asaas("/customers?externalReference=rsistemas-teste-pix-v1&limit=1");
    const cliente = clientes.data?.[0]?.id;
    if (!cliente) return res.status(503).json({ erro: "Cliente de teste do Sandbox indisponível." });
    const pedido = await banco("iniciar_checkout_pix_sandbox", { p_id, p_cliente, p_mesa, p_itens });
    let id = pedido.cobranca;
    if (!id) {
      const existentes = await asaas("/payments?externalReference=" + encodeURIComponent(p_id));
      let cobranca = existentes.data?.[0];
      if (!cobranca && pedido.criar) {
        cobranca = await asaas("/payments", {
          customer: cliente, billingType: "PIX", value: pedido.total_centavos / 100,
          dueDate: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()),
          description: "Pedido de teste R Sistemas", externalReference: p_id
        });
      }
      if (!cobranca) return res.status(409).json({ erro: "Cobrança ainda indisponível. Aguarde e tente novamente." });
      if (cobranca.customer !== cliente || cobranca.billingType !== "PIX" ||
          Math.round(cobranca.value * 100) !== pedido.total_centavos ||
          !/^pay_[a-z0-9]+$/i.test(cobranca.id)) {
        throw new Error("Cobrança divergente");
      }
      id = cobranca.id;
      await banco("vincular_pix_sandbox", {
        p_pedido: p_id, p_cobranca: id, p_valor: pedido.total_centavos
      });
    }
    const pix = await asaas("/payments/" + encodeURIComponent(id) + "/pixQrCode");
    return res.status(200).json({ imagem: pix.encodedImage, copiaECola: pix.payload, expiraEm: pix.expirationDate });
  } catch (erro) {
    console.error("Checkout Pix Sandbox", erro.message);
    return res.status(502).json({ erro: "Não foi possível preparar o Pix. Tente novamente neste pedido." });
  }
}
