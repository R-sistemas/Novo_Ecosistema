import { readFileSync } from "node:fs";
import { slugValido } from "../slug-loja.mjs";

export default function manifestCardapio(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const loja = req.query?.loja;
  if (!slugValido(loja)) {
    return res.status(400).end();
  }
  const nome = loja.split("-").map(parte => parte[0].toUpperCase() + parte.slice(1)).join(" ");
  const retirada = req.query?.manifesto === "retirada";
  const endereco = (retirada ? "/retirada.html" : "/cardapio.html") + "?loja=" + encodeURIComponent(loja);
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  if (retirada) {
    const modelo = JSON.parse(readFileSync(new URL("../retirada.webmanifest",import.meta.url),"utf8"));
    return res.status(200).send(JSON.stringify({...modelo,id:endereco,start_url:endereco,name:"Retirada · " + nome}));
  }
  return res.status(200).send(JSON.stringify({
    id: endereco, name: "Cardápio · " + nome, short_name: nome,
    start_url: endereco, scope: "/cardapio.html", display: "standalone", lang: "pt-BR",
    background_color: "#f4f6f2", theme_color: "#175d2d",
    icons: [192, 512].map(lado => ({ src: "/icone-pwa-" + lado + ".png", sizes: lado + "x" + lado, type: "image/png" }))
  }));
}
