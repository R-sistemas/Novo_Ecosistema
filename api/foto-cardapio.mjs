import manifestCardapio from "../lib/manifest-cardapio.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (req.query?.manifesto === "1") return manifestCardapio(req, res);
  const { id, v } = req.query ?? {};
  if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) ||
      typeof v !== "string" || !/^[a-f0-9]{32}$/.test(v)) return res.status(404).end();
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  if (!url || !chave) return res.status(503).end();
  try {
    const resposta = await fetch(new URL("/rest/v1/rpc/foto_publica_cardapio", url), {
      method: "POST",
      headers: { apikey: chave, Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({ p_produto: id, p_versao: v }),
      signal: AbortSignal.timeout(5000)
    });
    if (!resposta.ok) return res.status(502).end();
    const dados = await resposta.json();
    if (!dados) return res.status(404).end();
    const imagem = Buffer.from(dados.slice("data:image/webp;base64,".length), "base64");
    if (imagem.toString("ascii", 0, 4) !== "RIFF" || imagem.toString("ascii", 8, 12) !== "WEBP") {
      return res.status(404).end();
    }
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.status(200).send(imagem);
  } catch {
    return res.status(502).end();
  }
}
