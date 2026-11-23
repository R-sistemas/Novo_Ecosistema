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

export function listar(termo, pagina, atencao, situacao) {
  const consulta = new URLSearchParams({ busca: termo, pagina });
  if (atencao) consulta.set("atencao", "1");
  else if (situacao) consulta.set("situacao", situacao);
  return chamar("empresas?" + consulta, "GET");
}

export const editar = dados => chamar("empresas", "POST", dados);

export const alterarSuspensao = dados => chamar("empresas", "POST", { ...dados, acao: "suspensao" });

export const historicoLicenca = (empresa, pagina) =>
  chamar("licencas?" + new URLSearchParams({ empresa, pagina }), "GET");
export const quitarLicenca = dados => chamar("licencas", "POST", dados);

export const criarEmpresa = dados => chamar("onboarding", "POST", dados);

export async function definirSenhaGestor(convite, senha) {
  const resposta = await fetch("/api/central/ativar-gestor", {
    method: "POST", credentials: "omit", cache: "no-store",
    headers: { Authorization: "Bearer " + convite, "Content-Type": "application/json" },
    body: JSON.stringify({ senha })
  });
  if (!resposta.ok) throw new Error("Não foi possível definir a senha. Confira a senha ou a validade do convite.");
}
