export function configuracaoCartao(opcoes) {
  if (!opcoes?.credito || !["sandbox", "producao"].includes(opcoes.ambiente) ||
      typeof opcoes.chave_publica !== "string" || !opcoes.chave_publica.trim()) return null;
  return { ambiente: opcoes.ambiente, chavePublica: opcoes.chave_publica };
}
