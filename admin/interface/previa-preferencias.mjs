import { aplicarTema } from "../../tema-cardapio.mjs";
import { paraReais } from "../../pdv/regras/moeda.mjs";

const reais = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});

export function renderizarPrevia(painel,menu,rascunho) {
  aplicarTema(painel,rascunho.cardapio_cor,rascunho.cardapio_fundo);
  painel.querySelector("[data-previa-nome]").textContent = menu?.nome || rascunho.nome;
  for (const [tipo,campo] of Object.entries({logo:"cardapio_logo",agradecimento:"cardapio_agradecimento"})) {
    const imagem = painel.querySelector("[data-previa-" + tipo + "]");
    imagem.hidden = !rascunho[campo];
    if (rascunho[campo]) imagem.src = rascunho[campo];
    else imagem.removeAttribute("src");
  }
  const produtos = menu?.produtos?.slice(0,3) ?? [];
  painel.querySelector("[data-previa-produtos]").replaceChildren(...produtos.map(p => {
    const item = document.createElement("li");
    item.textContent = p.nome + " · " + reais.format(paraReais(p.preco_centavos));
    return item;
  }));
  painel.querySelector("[data-previa-vazia]").textContent = !menu
    ? "A loja ainda não tem uma vitrine pública disponível." : produtos.length ? "" : "Nenhum produto publicado.";
}
