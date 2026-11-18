export async function carregarAdministracao() {
  const caminho = new URL("../partes/administracao.html", import.meta.url);
  const resposta = await fetch(caminho, { cache: "no-cache" });
  if (!resposta.ok) {
    throw new Error("Não foi possível carregar a administração do PDV.");
  }
  const conteudo = await resposta.text();
  if (!conteudo.trim()) {
    throw new Error("A estrutura da administração está indisponível.");
  }
  return conteudo;
}
