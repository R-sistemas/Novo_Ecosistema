const chave = process.env.ASAAS_API_KEY?.trim();
const base = "https://api-sandbox.asaas.com/v3";
const referencia = "rsistemas-teste-pix-v1";

async function solicitar(caminho, dados) {
  const resposta = await fetch(base + caminho, {
    method: dados ? "POST" : "GET",
    headers: {
      access_token: chave,
      "User-Agent": "R-Sistemas-Sandbox/1.0",
      "Content-Type": "application/json"
    },
    body: dados ? JSON.stringify(dados) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => null);
    const detalhes = Array.isArray(corpo?.errors)
      ? corpo.errors.map(({ code, description }) => [code, description].filter(Boolean).join(" - ")).join(" | ")
      : "";
    const mensagem = caminho + " retornou HTTP " + resposta.status + (detalhes ? " · " + detalhes : "");
    throw new Error(mensagem.replaceAll(chave, "[chave ocultada]"));
  }
  return resposta.json();
}

async function executar() {
  if (!chave) throw new Error("Defina ASAAS_API_KEY com a chave do Sandbox.");
  const id = process.argv[2];
  if (id !== undefined) {
    if (!/^pay_[a-z0-9]+$/i.test(id)) throw new Error("Informe um identificador de cobrança válido.");
    const cobranca = await solicitar("/payments/" + encodeURIComponent(id));
    console.log("Cobrança de teste:", cobranca.id, cobranca.status);
    return;
  }
  const filtro = "?externalReference=" + encodeURIComponent(referencia);
  const clientes = await solicitar("/customers" + filtro);
  const cliente = clientes.data[0] ?? await solicitar("/customers", {
    name: "Cliente fictício R Sistemas",
    cpfCnpj: "24971563792",
    externalReference: referencia,
    notificationDisabled: true
  });

  const cobrancas = await solicitar("/payments" + filtro + "&customer=" + encodeURIComponent(cliente.id));
  const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const cobranca = cobrancas.data[0] ?? await solicitar("/payments", {
    customer: cliente.id,
    billingType: "PIX",
    value: 10,
    dueDate: hoje,
    description: "Simulação Pix R Sistemas",
    externalReference: referencia
  });
  console.log("Cobrança de teste:", cobranca.id, cobranca.status);
  const pix = await solicitar("/payments/" + encodeURIComponent(cobranca.id) + "/pixQrCode");
  if (!pix.payload || !pix.encodedImage) throw new Error("O Asaas não retornou o QR Code completo.");
  console.log("QR Code recebido. Expiração:", pix.expirationDate);
}

executar().catch(erro => {
  console.error(erro.message);
  process.exitCode = 1;
});
