import { prepararFinanceiro } from "./financeiro.mjs";
import { prepararLicenca, resumoLicenca } from "./licenca.mjs";

export function prepararFinanceiroLoja(area, aoAtualizar, abaAtiva) {
  const areaLicenca = document.createElement("section");
  const areaOperacional = document.createElement("div");
  areaLicenca.hidden = true;
  area.append(areaLicenca, areaOperacional);

  let resumo;
  let versaoLoja = 0;
  const somenteLicenca = () => resumo?.situacao === "restrita";
  const financeiro = prepararFinanceiro(areaOperacional);
  const licenca = prepararLicenca(areaLicenca, dados => {
    resumo = dados;
    areaOperacional.hidden = somenteLicenca();
    aoAtualizar();
  });

  return {
    somenteLicenca,
    limpar: financeiro.limpar,
    limparLoja() {
      versaoLoja++;
      resumo = undefined;
      licenca.limpar();
      financeiro.limpar();
    },
    async carregarLicenca(empresa) {
      const atual = versaoLoja;
      const dados = await resumoLicenca(empresa).catch(() => null);
      if (atual === versaoLoja) resumo = dados;
    },
    async abrirLoja(empresa) {
      const atual = versaoLoja;
      areaOperacional.hidden = somenteLicenca();
      await licenca.abrir(empresa, resumo);
      if (atual === versaoLoja && abaAtiva() && !somenteLicenca()) await financeiro.abrirLoja(empresa);
    }
  };
}
