const limitesEndereco = {
  logradouro: 150,
  numero: 20,
  bairro: 100,
  cidade: 100,
  complemento: 150
};

function coordenadas(endereco) {
  const latitude = endereco?.latitude;
  const longitude = endereco?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
}

function linkDoPino({ latitude, longitude }) {
  return `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

export function enderecoValido(endereco) {
  const ponto = coordenadas(endereco);
  return Boolean(ponto && endereco.maps_url === linkDoPino(ponto) &&
    Object.entries(limitesEndereco).every(([chave, limite]) =>
      endereco[chave] == null || (typeof endereco[chave] === "string" && endereco[chave].length <= limite)) &&
    (endereco.telefone == null || (typeof endereco.telefone === "string" && /^\d{10,11}$/.test(endereco.telefone))) &&
    (endereco.metodo_pagamento == null || ["pix", "credito", "dinheiro", "maquininha"].includes(endereco.metodo_pagamento)) &&
    (endereco.troco_para_centavos == null || (Number.isSafeInteger(endereco.troco_para_centavos) && endereco.troco_para_centavos >= 0)));
}

export function enderecoLegadoValido(endereco) {
  return endereco && typeof endereco === "object" &&
    ["logradouro", "numero", "bairro", "cidade"].every(chave =>
      typeof endereco[chave] === "string" && endereco[chave].trim() && endereco[chave].length <= limitesEndereco[chave]);
}

export function mapaDoEndereco(endereco) {
  if (enderecoValido(endereco)) return linkDoPino(coordenadas(endereco));
  if (enderecoLegadoValido(endereco) && !endereco.maps_url) {
    const descricao = [endereco.logradouro, endereco.numero, endereco.bairro, endereco.cidade, endereco.complemento]
      .filter(Boolean).map(valor => valor.trim()).join(", ");
    return new URL("https://www.google.com/maps/place/" + encodeURIComponent(descricao)).toString();
  }
  throw new Error("Endereço inválido.");
}

export async function cotarFreteRemo(slug, endereco) {
  const { REMO_API_URL, REMO_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!REMO_API_URL || !REMO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error("Cotação de entrega indisponível."), { status: 503 });
  }
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      !(enderecoValido(endereco) || (slug === "loja-teste" && enderecoLegadoValido(endereco)))) {
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
