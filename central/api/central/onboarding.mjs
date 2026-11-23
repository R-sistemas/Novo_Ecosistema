import { erroApi, iniciar, supabase, tokenDe, uuid } from "../../lib/supabase.mjs";

function cadastro(corpo = {}) {
  const { nome, slug, email, plano, preco_centavos, vencimento, pagamento, requisicao } = corpo ?? {};
  if (typeof nome !== "string" || !nome.trim() || nome.length > 100 ||
      typeof slug !== "string" || slug.length > 63 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
      typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !["basico", "pro"].includes(plano) || !["pago", "pendente"].includes(pagamento) ||
      !Number.isInteger(preco_centavos) || preco_centavos < 0 || preco_centavos > 2147483647 ||
      typeof vencimento !== "string" || !/^\d{4}-\d{2}-05$/.test(vencimento) || !uuid.test(requisicao ?? "")) return null;
  return { p_nome: nome, p_slug: slug, p_email: email, p_plano: plano, p_preco: preco_centavos,
    p_vencimento: vencimento, p_pagamento: pagamento, p_requisicao: requisicao };
}

function servico(caminho, chave, dados) {
  return supabase(caminho, { token: "Bearer " + chave, apikey: chave, dados });
}

export default async function onboarding(req, res) {
  if (!iniciar(req, res, ["POST"])) return;
  const token = tokenDe(req);
  if (!token) return erroApi(res, 401);
  const dados = cadastro(req.body);
  if (!dados) return erroApi(res, 400);
  const { SUPABASE_SERVICE_ROLE_KEY: chave, CENTRAL_GESTOR_REDIRECT: redirect } = process.env;
  if (!chave || !redirect) return erroApi(res, 503);
  let empresa;
  try {
    const destino = new URL(redirect);
    if (destino.protocol !== "https:" || destino.pathname !== "/ativar-gestor.html") return erroApi(res, 503);
    const criacao = await supabase("/rest/v1/rpc/central_criar_empresa", { token, dados });
    const corpo = await criacao.json();
    if (!criacao.ok) return erroApi(res, ["22023", "22007", "22008"].includes(corpo.code) ? 400 : criacao.status);
    if (!uuid.test(corpo)) return erroApi(res, 503);
    empresa = corpo;
    const consultar = () => servico("/rest/v1/rpc/central_dados_convite", chave,
      { p_empresa: empresa });
    const resposta = await consultar();
    if (!resposta.ok) throw new Error();
    const convite = await resposta.json();
    if (!convite?.vinculado) {
      if (!convite?.email || !uuid.test(convite.chave)) throw new Error();
      await servico("/auth/v1/invite?" + new URLSearchParams({ redirect_to: destino.href }), chave,
        { email: convite.email, data: { rs_convite: convite.chave } });
      const estado = await consultar();
      if (!estado.ok || !(await estado.json())?.vinculado) throw new Error();
    }
    return res.status(201).json({ empresa, convite: "vinculado" });
  } catch {
    if (empresa) return res.status(503).json({
      erro: "Empresa registrada. Convite pendente. Repita o envio com os mesmos dados."
    });
    return erroApi(res, 503);
  }
}
