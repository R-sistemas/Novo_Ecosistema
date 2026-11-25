const url = "https://eyqxxlcmxlilgogxdcoq.supabase.co";
let sessao;
let renovacao;

async function requisitar(caminho, dados, token, metodo = dados === undefined ? "GET" : "POST", base = url) {
  const chave = document.querySelector('meta[name="supabase-key"]').content.trim();
  if (!chave) throw new Error("Configure a chave publicável do Supabase.");
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: {
      apikey: chave,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(dados === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: dados === undefined ? undefined : JSON.stringify(dados)
  });
  const corpo = await resposta.text();
  const resultado = corpo ? JSON.parse(corpo) : null;
  if (!resposta.ok) throw Object.assign(new Error(resultado?.erro ?? resultado?.message ?? resultado?.msg ?? "Não foi possível concluir a solicitação."), { status: resposta.status });
  return resultado;
}

export async function solicitar(caminho, dados, metodo, base) {
  if (sessao && Date.now() >= sessao.expiraEm - 60_000) {
    if (!renovacao) {
      const atual = sessao;
      renovacao = requisitar("/auth/v1/token?grant_type=refresh_token", {
        refresh_token: atual.refresh_token
      }).then(nova => {
        if (sessao === atual) guardarSessao(nova);
      }).catch(() => {
        throw new Error("Não foi possível renovar a sessão. Tente novamente ou atualize a página e entre de novo.");
      }).finally(() => { renovacao = undefined; });
    }
    await renovacao;
  }
  return requisitar(caminho, dados, sessao?.access_token, metodo, base);
}

function guardarSessao(nova) {
  sessao = { ...nova, expiraEm: Date.now() + nova.expires_in * 1000 };
}

export async function entrar(email, password) {
  sessao = undefined;
  const nova = await requisitar("/auth/v1/token?grant_type=password", { email, password });
  guardarSessao(nova);
  return nova.user.id;
}

export async function confirmarSenhaAtual(email, password) {
  const usuario = sessao?.user.id;
  if (!usuario) throw Object.assign(new Error("Entre novamente."), { status: 401 });
  const nova = await requisitar("/auth/v1/token?grant_type=password", { email, password });
  if (nova.user.id !== usuario || sessao?.user.id !== usuario) {
    throw Object.assign(new Error("A conta atual mudou. Entre novamente."), { status: 403 });
  }
  guardarSessao(nova);
}

export async function criarMinhaConta(email, password) {
  const destino = new URL("/convite-equipe.html", location.origin).href;
  const nova = await requisitar("/auth/v1/signup?" + new URLSearchParams({ redirect_to: destino }), { email, password });
  if (!nova?.access_token) return false;
  guardarSessao(nova);
  return true;
}

export const listar = consulta => solicitar("/rest/v1/" + consulta);
export const executar = (nome, dados) => solicitar("/rest/v1/rpc/" + nome, dados);
export const executarApi = (caminho, dados) => solicitar("/api/" + caminho, dados, "POST", "");

export function solicitarRecuperacaoSenha(email, destino) {
  return requisitar("/auth/v1/recover?" + new URLSearchParams({ redirect_to: destino }), { email });
}

export async function redefinirSenha(token, password) {
  await requisitar("/auth/v1/user", { password }, token, "PUT");
  await requisitar("/auth/v1/logout?scope=local", undefined, token, "POST").catch(() => {});
}
