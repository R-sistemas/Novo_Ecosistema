import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mercadoPago } from "./lib/mercado-pago.mjs";

const host = "127.0.0.1";
const porta = 4179;
const origem = `http://${host}:${porta}`;
const cliente = mercadoPago(process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN);
const ordens = new Map();

createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.host !== `${host}:${porta}`) return res.writeHead(403).end();
  if (req.method === "GET" && req.url === "/") {
    const html = await readFile(new URL("./mercado-pago-cartao-teste.html", import.meta.url));
    return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  }
  if (req.method !== "POST" || req.url !== "/ordem") return res.writeHead(404).end();
  if (req.headers.origin !== origem) return res.writeHead(403).end();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    let corpo = "";
    for await (const parte of req) {
      corpo += parte;
      if (corpo.length > 4096) throw new Error("Requisição inválida.");
    }
    const { modalidade, token, bandeira, pagador } = JSON.parse(corpo);
    if (!["credit_card", "debit_card"].includes(modalidade) ||
        typeof token !== "string" || !/^[a-z0-9_-]{10,256}$/i.test(token) ||
        typeof bandeira !== "string" || !/^[a-z0-9_]{1,32}$/i.test(bandeira) ||
        typeof pagador?.email !== "string") throw new Error("Dados de teste inválidos.");
    if (!ordens.has(token)) ordens.set(token, randomUUID());
    const ordem = await cliente.criarCartao({
      pedidoId: ordens.get(token), totalCentavos: 5000,
      pagador: { email: pagador.email, identification: pagador.identification },
      metodo: { id: bandeira, type: modalidade, token, installments: 1 }
    });
    if (!/^ORDTST[A-Z0-9]+$/.test(ordem.id)) throw new Error("Resposta fora do ambiente de teste.");
    const tipo = ordem.transactions?.payments?.[0]?.payment_method?.type;
    const resultado = { id: ordem.id, tipo, status: ordem.status, detalhe: ordem.status_detail };
    console.log("Cartão de teste:", resultado);
    res.end(JSON.stringify(resultado));
  } catch (erro) {
    const mensagem = erro instanceof SyntaxError ? "Requisição inválida." : erro.message;
    res.writeHead(400).end(JSON.stringify({ erro: mensagem }));
  }
}).listen(porta, host, () => console.log("Abra " + origem + " no navegador. Ctrl+C encerra o teste."));
