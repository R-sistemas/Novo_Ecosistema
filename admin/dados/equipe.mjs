import { solicitar } from "../../supabase-pdv.mjs";

const rota = empresa => "/api/painel-equipe?" + new URLSearchParams({empresa_id:empresa});
export const consultarEquipe = empresa => solicitar(rota(empresa),undefined,"GET","");
export const mudarEquipe = (empresa,acao,dados) => solicitar(rota(empresa),{acao,dados},"POST","");
export const criarOperador = (empresa,entrada) => solicitar(rota(empresa),{...entrada,acao:"cadastrar"},"POST","");
