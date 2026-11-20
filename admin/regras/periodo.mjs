import { formatarDia } from "../../monitor/regras/registros.mjs";

const dias = {hoje:1,"7":7,"30":30};
export function dataValida(dia) {
  return typeof dia === "string" && /^\d{4}-\d\d-\d\d$/.test(dia) &&
    Number.isFinite(Date.parse(dia)) && new Date(dia).toISOString().slice(0,10) === dia;
}
function somar(dia,n) {
  const data = new Date(dia);
  data.setUTCDate(data.getUTCDate()+n);
  return data.toISOString().slice(0,10);
}
export function periodo(tipo,inicio,fim,agora=new Date()) {
  if (tipo === "personalizado") {
    if (!dataValida(inicio) || !dataValida(fim) || inicio > fim) throw new Error("Confira as datas do período.");
    return {inicio,fim:somar(fim,1),ultimoDia:fim};
  }
  const hoje = formatarDia.format(agora);
  return {inicio:somar(hoje,1-dias[tipo]),fim:somar(hoje,1),ultimoDia:hoje};
}

// Atalho para Pedidos: converte as fronteiras civis em instantes no fuso do Monitor.
export function meiaNoiteSP(dia) {
  const formato = new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",timeZoneName:"longOffset"});
  const utc = Date.parse(dia);
  const offset = instante => formato.formatToParts(instante).find(p=>p.type==="timeZoneName").value.replace("GMT","");
  const aproximada = new Date(dia+"T00:00:00"+offset(utc+12*3600000));
  const final = new Date(dia+"T00:00:00"+offset(aproximada));
  return (final.getTime()<aproximada.getTime()?aproximada:final).toISOString();
}
