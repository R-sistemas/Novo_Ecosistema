import { recebedorSandboxMP } from "../lib/mercado-pago-ambiente.mjs";
import { bancoMercadoPagoTeste as banco } from "../lib/banco-mercado-pago-teste.mjs";
import { cifrarCredencialMP } from "../lib/cofre-mercado-pago.mjs";
import { mercadoPago } from "../lib/mercado-pago.mjs";
import { chamarSupabasePainel, uuid } from "../lib/painel-sessao.mjs";

const segredoValido = valor => typeof valor === "string" && /^[\x21-\x7e]{12,512}$/.test(valor);
const prefixoValido = (valor, ambiente) => valor.startsWith("APP_USR-") || (ambiente === "sandbox" && valor.startsWith("TEST-"));
const erro = (res, status, mensagem) => res.status(status).json({ erro: mensagem });

export default async function credencialMP(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).end();
  }
  const token = req.headers.authorization;
  if (typeof token !== "string" || !/^Bearer [\w.-]+$/.test(token)) return erro(res, 401, "Entre novamente no painel.");
  const { empresa, ambiente } = req.query ?? {};
  if (!uuid.test(empresa ?? "") || !["producao", "sandbox"].includes(ambiente)) return erro(res, 400, "Confira a empresa e o ambiente.");
  const chamar = chamarSupabasePainel(token);
  if (!chamar) return erro(res, 503, "Configuração indisponível.");

  try {
    const status = await chamar("/rest/v1/rpc/loja_status_credencial_mp", {
      method: "POST", body: JSON.stringify({ p_empresa: empresa, p_ambiente: ambiente })
    });
    if (!status.ok) return erro(res, [401, 403].includes(status.status) ? status.status : 503, "Configuração indisponível.");
    const atual = await status.json();
    if (req.method === "GET") return res.status(200).json(atual);
    if (req.method === "DELETE") {
      const revisao = req.body?.revisao;
      if (!Number.isSafeInteger(revisao) || revisao < 1) return erro(res, 400, "Confira a revisão.");
      const resposta = await chamar("/rest/v1/rpc/loja_revogar_credencial_mp", {
        method: "POST", body: JSON.stringify({ p_empresa: empresa, p_ambiente: ambiente, p_revisao: revisao })
      });
      if (!resposta.ok) return erro(res, [401, 403, 409].includes(resposta.status) ? resposta.status : 503, "Não foi possível revogar a credencial.");
      return res.status(200).json(await resposta.json());
    }
    const { access_token, webhook_secret, chave_publica, revisao } = req.body ?? {};
    if (!segredoValido(access_token) || !prefixoValido(access_token, ambiente) ||
        !segredoValido(webhook_secret) || !segredoValido(chave_publica) || !prefixoValido(chave_publica, ambiente) ||
        !Number.isSafeInteger(revisao) || revisao < 0) return erro(res, 400, "Confira as credenciais e o ambiente.");
    if (revisao !== atual.revisao) return erro(res, 409, "Recarregue a configuração.");
    const auth = await chamar("/auth/v1/user");
    if (!auth.ok) return erro(res, 401, "Entre novamente no painel.");
    const { id } = await auth.json();
    if (!uuid.test(id ?? "")) return erro(res, 401, "Entre novamente no painel.");
    let conta;
    try {
      conta = await mercadoPago(access_token).consultarConta();
    } catch (falha) {
      if ([400, 401, 403].includes(falha.status)) return erro(res, 422, "O Mercado Pago recusou o Access Token.");
      throw falha;
    }
    const recebedor = typeof conta.id === "string" || Number.isSafeInteger(conta.id) ? String(conta.id) : "";
    if (!/^\d{1,32}$/.test(recebedor) || conta.site_id !== "MLB") return erro(res, 422, "Conta Mercado Pago Brasil não confirmada.");
    if ((ambiente === "sandbox") !== (recebedor === recebedorSandboxMP)) {
      return erro(res, 422, "A conta Mercado Pago não corresponde ao ambiente.");
    }
    const envelope = cifrarCredencialMP({ access_token, webhook_secret }, { empresa, ambiente, recebedor });
    const resultado = await banco("servico_gravar_credencial_mp", {
      p_empresa: empresa, p_ambiente: ambiente, p_autor: id, p_recebedor: recebedor,
      p_envelope: envelope, p_chave_publica: chave_publica, p_revisao: revisao
    });
    return res.status(200).json(resultado);
  } catch (falha) {
    if (falha.codigo === "23505") return erro(res, 409, "Recarregue a configuração.");
    if (falha.codigo === "42501") return erro(res, 403, "Acesso negado.");
    return erro(res, 503, "Configuração indisponível.");
  }
}
