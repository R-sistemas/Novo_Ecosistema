export function linkDaMesa({loja,mesa},base) {
  const link = new URL("./cardapio.html",base);
  link.search = new URLSearchParams({loja,mesa});
  return link.href;
}
