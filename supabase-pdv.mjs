const url = "https://eyqxxlcmxlilgogxdcoq.supabase.co";
let sessao;
let renovacao;

async function requisitar(caminho, dados, token, metodo = dados === undefined ? "GET" : "POST") {
  const chave = document.querySelector('meta[name="supabase-key"]').content.trim();
  if (!chave) throw new Error("Configure a chave publicável do Supabase.");
  const resposta = await fetch(url + caminho, {
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
  if (!resposta.ok) throw new Error(resultado?.message ?? resultado?.msg ?? "Falha ao acessar o Supabase.");
  return resultado;
}

async function solicitar(caminho, dados, metodo) {
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
  return requisitar(caminho, dados, sessao?.access_token, metodo);
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

export const listar = consulta => solicitar("/rest/v1/" + consulta);
export const executar = (nome, dados) => solicitar("/rest/v1/rpc/" + nome, dados);
export const cadastrarProduto = dados => solicitar("/rest/v1/produtos", dados);
export const desativarProduto = (empresa, id) =>
  solicitar("/rest/v1/produtos?empresa_id=eq." + empresa + "&id=eq." + id, { ativo: false }, "PATCH");
