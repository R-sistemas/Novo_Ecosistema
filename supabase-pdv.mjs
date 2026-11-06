const url = "https://eyqxxlcmxlilgogxdcoq.supabase.co";
let token;

async function solicitar(caminho, dados) {
  const chave = document.querySelector('meta[name="supabase-key"]').content.trim();
  if (!chave) throw new Error("Configure a chave publicável do Supabase.");
  const resposta = await fetch(url + caminho, {
    method: dados === undefined ? "GET" : "POST",
    headers: {
      apikey: chave,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(dados === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: dados === undefined ? undefined : JSON.stringify(dados)
  });
  const resultado = await resposta.json();
  if (!resposta.ok) throw new Error(resultado.message ?? resultado.msg ?? "Falha ao acessar o Supabase.");
  return resultado;
}

export async function entrar(email, password) {
  token = undefined;
  const sessao = await solicitar("/auth/v1/token?grant_type=password", { email, password });
  token = sessao.access_token;
  return sessao.user.id;
}

export const listar = consulta => solicitar("/rest/v1/" + consulta);
export const executar = (nome, dados) => solicitar("/rest/v1/rpc/" + nome, dados);
