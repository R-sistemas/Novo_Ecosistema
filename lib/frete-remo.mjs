const limitesEndereco = {
  logradouro: 150,
  numero: 20,
  bairro: 100,
  cidade: 100,
  complemento: 150
};

function linkMapaValido(valor) {
  if (!valor) return true;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" &&
      ["google.com", "www.google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl"].includes(url.hostname) &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function enderecoValido(endereco) {
  return endereco && typeof endereco === "object" &&
    ["logradouro", "numero", "bairro", "cidade"].every(chave =>
      typeof endereco[chave] === "string" && endereco[chave].trim() && endereco[chave].length <= limitesEndereco[chave]) &&
    (!endereco.complemento || (typeof endereco.complemento === "string" && endereco.complemento.length <= limitesEndereco.complemento)) &&
    (!endereco.maps_url || (typeof endereco.maps_url === "string" && endereco.maps_url.length <= 500 && linkMapaValido(endereco.maps_url.trim())));
}

export function mapaDoEndereco(endereco) {
  if (!enderecoValido(endereco)) throw new Error("Endereço inválido.");
  const completo = [endereco.logradouro, endereco.numero, endereco.bairro, endereco.cidade, endereco.complemento]
    .filter(Boolean).map(valor => valor.trim()).join(", ");
  return endereco.maps_url?.trim() ||
    new URL("https://www.google.com/maps/place/" + encodeURIComponent(completo)).toString();
}

export async function cotarFreteRemo(slug, endereco) {
  const { REMO_API_URL, REMO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!REMO_API_URL || !REMO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error("Cotação de entrega indisponível."), { status: 503 });
  }
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !enderecoValido(endereco)) {
    throw Object.assign(new Error("Confira o endereço da entrega."), { status: 400 });
  }
  let empresa;
  try {
    const consultaEmpresa = new URL("/rest/v1/empresas", SUPABASE_URL);
    consultaEmpresa.search = new URLSearchParams({ select: "id", cardapio_slug: `eq.${slug}` }).toString();
    const respostaEmpresa = await fetch(consultaEmpresa, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(5000)
    });
    const empresas = await respostaEmpresa.json();
    if (!respostaEmpresa.ok || !Array.isArray(empresas) || empresas.length !== 1 ||
        typeof empresas[0].id !== "string" || !/^[a-f0-9-]{36}$/i.test(empresas[0].id)) {
      throw new Error("loja_sem_vinculo");
    }
    empresa = empresas[0];
  } catch {
    throw Object.assign(new Error("Esta loja ainda não está vinculada à REMO."), { status: 422 });
  }
  const mapa = mapaDoEndereco(endereco);
  const url = new URL(`/api/v1/frete/r-sistemas/${encodeURIComponent(empresa.id)}/preview`, REMO_API_URL);
  let resposta;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": REMO_API_KEY },
      body: JSON.stringify({ client_maps_url: mapa }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw Object.assign(new Error("Não foi possível calcular o frete agora."), { status: 502 });
  }
  const resultado = await resposta.json().catch(() => null);
  const centavos = Math.round(Number(resultado?.fee) * 100);
  if (!resposta.ok || !resultado?.ok || !Number.isSafeInteger(centavos) || centavos < 0) {
    throw Object.assign(new Error("Não foi possível calcular o frete para este endereço."), { status: 422 });
  }
  return centavos;
}
