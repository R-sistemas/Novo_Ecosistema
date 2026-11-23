import { cotarFreteRemo, enderecoValido, enderecoLegadoValido } from "./frete-remo.mjs";

export async function cotarFreteCheckout(req, res) {
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
