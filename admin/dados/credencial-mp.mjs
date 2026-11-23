import { solicitar } from "../../supabase-pdv.mjs";

const rota = empresa => "/api/credencial-mercado-pago?" + new URLSearchParams({ empresa, ambiente: "producao" });
export const lerCredencialMP = empresa => solicitar(rota(empresa), undefined, "GET", "");
export const gravarCredencialMP = (empresa, dados) => solicitar(rota(empresa), dados, "POST", "");
export const revogarCredencialMP = (empresa, revisao) => solicitar(rota(empresa), { revisao }, "DELETE", "");
