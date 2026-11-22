import { executar } from "../../supabase-pdv.mjs";

export const consultarLicencaPdv = empresa => executar("licenca_pdv", { p_empresa: empresa });
