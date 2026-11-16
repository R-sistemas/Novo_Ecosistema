const limpar = valor => String(valor ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\x20-\x7e]/g, " ").trim();

function linhas(texto, largura = 48) {
  const palavras = limpar(texto).split(/\s+/);
  const resultado = [];
  let linha = "";
  for (const palavra of palavras) {
    if (linha && (linha.length + palavra.length + 1 > largura)) {
      resultado.push(linha);
      linha = "";
    }
    linha += (linha ? " " : "") + palavra.slice(0, largura);
  }
  if (linha) resultado.push(linha);
  return resultado;
}

export function cupomCozinha(pedido, reimpressao = false) {
  const bytes = [27, 64, 27, 97, 1, 27, 69, 1];
  const escrever = texto => { for (const caractere of texto) bytes.push(caractere.charCodeAt(0)); bytes.push(10); };
  escrever(reimpressao ? "REIMPRESSAO - COZINHA" : "PEDIDO - COZINHA");
  escrever("COMANDA " + limpar(pedido.comanda || "-"));
  bytes.push(27, 69, 0, 27, 97, 0);
  escrever("-".repeat(48));
  for (const linha of linhas("Cliente: " + pedido.cliente)) escrever(linha);
  escrever(pedido.pagamento_entrega ? "ENTREGA" : pedido.mesa ? "MESA " + limpar(pedido.mesa) : "PEDIDO LOCAL");
  if (pedido.endereco_entrega?.telefone) escrever("Contato: " + limpar(pedido.endereco_entrega.telefone));
  if (pedido.adicional) escrever("ITENS ADICIONAIS");
  escrever("-".repeat(48));
  for (const item of pedido.itens || []) {
    for (const linha of linhas(`${item.quantidade} x ${item.nome}`)) escrever(linha);
  }
  escrever("-".repeat(48));
  escrever(new Date().toLocaleString("pt-BR"));
  bytes.push(27, 100, 3, 29, 86, 0);
  return btoa(String.fromCharCode(...bytes));
}

export function imprimirCozinha(pedido, reimpressao = false) {
  const ponte = window.AndroidPrint;
  if (!ponte || typeof ponte.print !== "function") {
    return { ok: false, mensagem: "Pedido aceito. Para imprimir, abra a cozinha no aplicativo Android com a Bematech." };
  }
  try {
    if (!ponte.isConnected()) {
      ponte.connect();
      return { ok: false, mensagem: "Pedido aceito. Autorize a Bematech no Android e toque em Reimprimir." };
    }
    const ok = ponte.print(cupomCozinha(pedido, reimpressao));
    return ok
      ? { ok: true, mensagem: reimpressao ? "Comanda reimpressa." : "Pedido aceito e impresso na cozinha." }
      : { ok: false, mensagem: "Pedido aceito, mas a impressão não foi confirmada. Confira a Bematech antes de reimprimir." };
  } catch {
    return { ok: false, mensagem: "Pedido aceito, mas a impressão falhou. Confira a Bematech antes de reimprimir." };
  }
}
