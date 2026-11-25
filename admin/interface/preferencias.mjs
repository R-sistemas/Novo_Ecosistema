import { coordenadasDoMapa, linkDoCentro } from "../regras/link-mapa.mjs";
import { consultarPreferencias, consultarVitrine, salvarPreferencias } from "../dados/preferencias.mjs";
import { alteracoesPreferencias, imagens, validarPreferencias } from "../regras/preferencias.mjs";
import { otimizarImagemAparencia } from "../../imagens-cardapio.mjs";
import { renderizarPrevia } from "./previa-preferencias.mjs";

export function prepararPreferencias(area,avisar) {
  const form = area.querySelector("form");
  const campos = form.elements;
  const grupos = [...form.querySelectorAll("fieldset")];
  const erro = area.querySelector("[role=alert]");
  const painel = area.querySelector("[data-previa]");
  const metodos = area.querySelector("[data-metodos]");
  const mapaAtual = area.querySelector("[data-mapa-atual]");
  let empresa, original, menu, arte, ocupada = false, versao = 0;
  const bloquear = ativo => {
    ocupada = ativo;
    for (const grupo of grupos) grupo.disabled = ativo;
    form.querySelector('[type="submit"]').disabled = ativo;
  };
  const rascunho = () => ({
    nome:original.nome, ...arte,
    cardapio_cor:campos.cardapio_cor.value, cardapio_fundo:campos.cardapio_fundo.value,
    oferece_entrega:campos.oferece_entrega.checked,
    pagamento_na_entrega:campos.pagamento_na_entrega.checked
  });
  const previa = () => {
    if (original) renderizarPrevia(painel,menu,rascunho());
  };
  const mensagem = falha => falha.status === 403 ? "Somente o gestor pode configurar esta loja."
    : falha.status === 401 ? "Sua sessão terminou. Entre novamente."
    : falha.status === 502 || falha.status === 503 ? "Não foi possível consultar as preferências." : falha.message;

  function preencher(config) {
    original = config;
    for (const campo of ["cardapio_cor","cardapio_fundo"])
      campos[campo].value = config[campo] ?? "";
    const link = linkDoCentro(config);
    campos.mapa_link.value = link;
    mapaAtual.hidden = !link;
    if (link) mapaAtual.href = link;
    else mapaAtual.removeAttribute("href");
    campos.oferece_entrega.checked = config.oferece_entrega === true;
    campos.pagamento_na_entrega.checked = config.pagamento_na_entrega;
    arte = Object.fromEntries(Object.keys(imagens).map(c => [c,config[c]]));
    metodos.textContent = !config.metodos ? "Métodos públicos indisponíveis sem link de cardápio."
      : [["Pix","pix"],["Crédito","credito"],["Débito","debito"]]
        .map(([rotulo,chave])=>rotulo+": "+(config.metodos[chave] ? "disponível" : "indisponível")).join(" · ");
    previa();
  }

  async function publicacao(config) {
    return config.slug ? consultarVitrine(config.slug) : null;
  }
  form.addEventListener("input",previa);
  for (const [campo,tipo] of Object.entries({cardapio_logo:"logo",cardapio_agradecimento:"agradecimento"})) {
    const arquivo = campos["arquivo_" + tipo];
    arquivo.onchange = async () => {
      const anexado = arquivo.files[0];
      if (!anexado || ocupada || !original) return;
      const atual = versao;
      erro.textContent = "";
      bloquear(true);
      try {
        const imagem = await otimizarImagemAparencia(anexado,tipo);
        if (atual !== versao) return;
        validarPreferencias({[campo]:imagem});
        arte[campo] = imagem;
        previa();
      } catch (falha) {
        if (atual === versao) erro.textContent = mensagem(falha);
      } finally {
        if (atual === versao) { arquivo.value = ""; bloquear(false); }
      }
    };
    area.querySelector("[data-remover-" + tipo + "]").onclick = () => {
      if (ocupada || !original) return;
      arte[campo] = null;
      previa();
    };
  }

  form.onsubmit = async evento => {
    evento.preventDefault();
    if (ocupada || !original) return;
    const atual = versao;
    erro.textContent = "";
    bloquear(true);
    try {
      const dados = alteracoesPreferencias(original,{...rascunho(),...coordenadasDoMapa(campos.mapa_link.value)});
      if (!Object.keys(dados).length) return;
      const confirmada = await salvarPreferencias(empresa,dados);
      if (atual !== versao) return;
      preencher(confirmada);
      avisar("Preferências salvas.");
      try {
        const nova = await publicacao(confirmada);
        if (atual === versao) { menu = nova; previa(); }
      } catch {
        if (atual === versao) erro.textContent = "Preferências salvas. Não foi possível atualizar a prévia pública.";
      }
    } catch (falha) {
      if (atual === versao) erro.textContent = mensagem(falha);
    } finally {
      if (atual === versao) bloquear(false);
    }
  };

  return async loja => {
    const atual = ++versao;
    empresa = loja;
    original = menu = undefined;
    erro.textContent = "";
    painel.hidden = true;
    metodos.textContent = "";
    mapaAtual.hidden = true;
    mapaAtual.removeAttribute("href");
    form.reset();
    bloquear(true);
    try {
      const config = await consultarPreferencias(loja);
      const vitrine = await publicacao(config);
      if (atual !== versao) return;
      menu = vitrine;
      preencher(config);
      painel.hidden = false;
      bloquear(false);
    } catch (falha) {
      if (atual === versao) erro.textContent = mensagem(falha);
    }
  };
}
