let token;

async function chamar(rota, metodo, dados) {
  const resposta = await fetch("/api/central/" + rota, {
    method: metodo, credentials: "omit", cache: "no-store",
    headers: { ...(token && { Authorization: "Bearer " + token }), "Content-Type": "application/json" },
    body: dados === undefined ? undefined : JSON.stringify(dados)
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw Object.assign(new Error(corpo.erro ?? "Serviço indisponível."), { status: resposta.status });
  return corpo;
}

export async function entrar(email, senha) {
  const sessao = await chamar("sessao", "POST", { acao: "entrar", email, senha });
  token = sessao.token;
  return sessao.fatores;
}

export async function verificar(fator, codigo) {
  const sessao = await chamar("sessao", "POST", { acao: "verificar", fator, codigo });
  token = sessao.token;
}

export function sair() {
  const pedido = token ? chamar("sessao", "DELETE").catch(() => {}) : Promise.resolve();
  token = undefined;
  return pedido;
}

export function listar(termo, pagina) {
  return chamar("empresas?" + new URLSearchParams({ busca: termo, pagina }), "GET");
}

export const editar = dados => chamar("empresas", "POST", dados);
