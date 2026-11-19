import { aplicarTema } from "../../tema-cardapio.mjs";
import { otimizarImagemAparencia } from "../../imagens-cardapio.mjs";
import { salvarAparencia } from "../dados/administracao.mjs";

export function configurarAparencia({ el, operar, modalAdminAtivo }) {
  let aparencia;
  function previaAparencia() {
    aplicarTema(el("previa-aparencia"), el("cor-cardapio").value, el("fundo-cardapio").value);
    for (const tipo of ["logo", "agradecimento"]) {
      const img = el("previa-" + tipo);
      img.hidden = !aparencia[tipo];
      if (aparencia[tipo]) img.src = aparencia[tipo];
      else img.removeAttribute("src");
    }
  }
  el("cor-cardapio").oninput = previaAparencia;
  el("fundo-cardapio").onchange = previaAparencia;
  for (const tipo of ["logo", "agradecimento"]) {
    el(tipo + "-cardapio").onchange = () =>
      operar(async () => {
        const campo = el(tipo + "-cardapio");
        if (!campo.files.length) return "";
        try {
          aparencia[tipo] = await otimizarImagemAparencia(campo.files[0],tipo);
          previaAparencia();
          return "Imagem otimizada. Salve a aparência para publicar.";
        } finally {
          campo.value = "";
        }
      });
  }
  el("restaurar-aparencia").onclick = () => {
    el("aparencia-cardapio").reset();
    aparencia = { logo: null, agradecimento: null };
    previaAparencia();
    modalAdminAtivo().status.textContent = "Visual padrão na prévia. Salve para publicar.";
  };
  el("aparencia-cardapio").onsubmit = (evento) => {
    evento.preventDefault();
    operar(async () => {
      await salvarAparencia({
        p_empresa: el("empresa").value,
        p_cor: el("cor-cardapio").value,
        p_fundo: el("fundo-cardapio").value,
        p_logo: aparencia.logo,
        p_agradecimento: aparencia.agradecimento,
      });
      return "Aparência publicada no cardápio.";
    }, true);
  };
  return (config) => {
    aparencia = {
      logo: config.cardapio_logo,
      agradecimento: config.cardapio_agradecimento,
    };
    previaAparencia();
  };
}
