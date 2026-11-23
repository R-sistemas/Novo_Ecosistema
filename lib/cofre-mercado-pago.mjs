import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function chave(versao) {
  if (!/^v[1-9][0-9]{0,2}$/.test(versao)) throw new Error("Versão de cofre inválida");
  const campo = "MP_PEDIDOS_COFRE_" + versao.toUpperCase();
  const valor = process.env[campo] ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(valor)) throw new Error("Cofre de pagamentos indisponível");
  return Buffer.from(valor, "base64url");
}

function contexto({ empresa, ambiente, recebedor }) {
  return Buffer.from(JSON.stringify(["mp-pedidos", empresa.toLowerCase(), ambiente, recebedor]));
}

export function cifrarCredencialMP(segredos, destino) {
  const versao = process.env.MP_PEDIDOS_COFRE_VERSAO ?? "v1";
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", chave(versao), iv);
  cifrador.setAAD(contexto(destino));
  const dados = Buffer.concat([cifrador.update(JSON.stringify(segredos), "utf8"), cifrador.final()]);
  return [versao, iv, cifrador.getAuthTag(), dados].map(item =>
    typeof item === "string" ? item : item.toString("base64url")).join(".");
}

export function decifrarCredencialMP(envelope, destino) {
  const [versao, iv, tag, corpo, excesso] = envelope.split(".");
  if (!iv || !tag || !corpo || excesso !== undefined) throw new Error("Credencial indisponível");
  const decifrador = createDecipheriv("aes-256-gcm", chave(versao), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decifrador.setAAD(contexto(destino));
  decifrador.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decifrador.update(Buffer.from(corpo, "base64url")), decifrador.final()]).toString("utf8"));
}
