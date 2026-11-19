import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";

const erros = {
  400: "produto_invalido", 401: "sessao_invalida", 403: "acesso_negado",
  404: "produto_indisponivel", 409: "conflito_produto", 422: "produto_invalido"
};

export async function painelCatalogo(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const leitura = req.method === "GET";
  if (!leitura && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end();
  }
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer \S+$/i.test(authorization)) {
    return res.status(401).json({ erro: "sessao_invalida" });
  }
  const { empresa_id, cursor } = req.query ?? {};
  const { produto_id = null, dados } = req.body ?? {};
  const idValido = id => typeof id === "string" && uuid.test(id);
  if (!idValido(empresa_id) ||
      (leitura && cursor !== undefined && !idValido(cursor)) ||
      (!leitura && ((produto_id !== null && !idValido(produto_id)) ||
        !dados || typeof dados !== "object" || Array.isArray(dados)))) {
    return res.status(400).json({ erro: "produto_invalido" });
  }

  const chamar = chamarSupabasePainel(authorization);
  if (!chamar) return res.status(503).json({ erro: "catalogo_indisponivel" });

  const rpc = leitura ? "painel_listar_produtos" : "painel_gravar_produto";
  const body = leitura
    ? { p_empresa_id: empresa_id, p_cursor: cursor ?? null, p_limite: 25 }
    : { p_empresa_id: empresa_id, p_produto_id: produto_id, p_dados: dados };
  try {
    const resposta = await chamar("/rest/v1/rpc/" + rpc, { method: "POST", body: JSON.stringify(body) });
    if (!resposta.ok) {
      const erro = erros[resposta.status];
      if (erro) return res.status(resposta.status).json({ erro });
      throw new Error("Falha na operação do catálogo");
    }
    return res.status(200).json(await resposta.json());
  } catch {
    return res.status(502).json({ erro: "catalogo_indisponivel" });
  }
}
