const anfitrioes = new Set(["google.com","google.com.br","google.co.uk","maps.google.com","maps.google.com.br"]);
const curto = new Set(["maps.app.goo.gl","goo.gl","www.goo.gl"]);
const decimal = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const par = new RegExp(`^\\s*(${decimal})\\s*,\\s*(${decimal})\\s*$`);
const ponto = new RegExp(`!3d(${decimal})!4d(${decimal})(?=!|/|$)`);
const centro = new RegExp(`@(${decimal}),(${decimal})(?=,|/|$)`);
const orientacao = "Copie o link completo do Google Maps com as coordenadas na barra de endereço.";

export function coordenadasDoMapa(texto) {
  if (!texto.trim()) return {mapa_centro_latitude:null,mapa_centro_longitude:null};
  let url,caminho;
  try {
    url = new URL(texto.trim());
    caminho = decodeURIComponent(url.pathname);
  } catch {
    throw new Error(orientacao);
  }
  const host = url.hostname.replace(/^www\./,"");
  if (curto.has(host)) throw new Error("Links curtos não mostram as coordenadas. Abra o link no Google Maps e copie o endereço completo.");
  if (url.protocol !== "https:" || url.username || url.password || url.port || !anfitrioes.has(host) ||
      (!host.startsWith("maps.") && !/^\/maps(?:\/|$)/.test(caminho))) throw new Error(orientacao);

  const busca = url.searchParams.get("q") ?? url.searchParams.get("query");
  const lugar = caminho.match(/\/place\/([^/]+)/)?.[1]?.replaceAll("+"," ");
  const resultado = (busca && par.exec(busca)) || ponto.exec(caminho) ||
    (lugar && par.exec(lugar)) || centro.exec(caminho);
  if (!resultado) throw new Error(orientacao);
  const latitude = Number(resultado[1]), longitude = Number(resultado[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) {
    throw new Error("Coordenadas fora da faixa: latitude de −90 a 90 e longitude de −180 a 180.");
  }
  return {mapa_centro_latitude:latitude,mapa_centro_longitude:longitude};
}

export function linkDoCentro({mapa_centro_latitude:lat,mapa_centro_longitude:lng}) {
  return lat == null || lng == null ? "" : `https://www.google.com/maps?q=${lat},${lng}`;
}