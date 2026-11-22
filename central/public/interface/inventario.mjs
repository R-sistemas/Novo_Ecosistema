import { listar } from "../dados/central.mjs";
import { resumoLicenca } from "../regras/licenca.mjs";
import { editor } from "./editor.mjs";
import { selo } from "./selo.mjs";

const el = id => document.getElementById(id);

export function inventario(sair) {
  const painel = el("inventario");
  const corpo = el("empresas");
  const erro = el("erro-lista");
  const rotulos = [...document.querySelectorAll("#rolagem thead th")];
  const anterior = el("anterior");
  const proxima = el("proxima");
  const busca = el("busca");
  const paineis = ["carregando", "rolagem", "vazio", "falha"].map(el);
  const edicao = editor(painel, () => carregar(pagina), sair);
  let pagina = 1;
  let destinoAtual = 1;
  let termo = "";
  let versao = 0;

  function mostrar(estado) {
    for (const secao of paineis) secao.hidden = secao.id !== estado;
  }

  function linha(empresa) {
    const tr = document.createElement("tr");
    const nome = document.createElement("th");
    tr.setAttribute("role", "row");
    nome.scope = "row";
    nome.setAttribute("role", "rowheader");
    nome.textContent = empresa.nome;
    const slug = document.createElement("small");
    slug.textContent = empresa.cardapio_slug ?? "Sem slug";
    nome.append(slug);
    tr.append(nome);

    const resumo = resumoLicenca(empresa);
    const atraso = document.createElement("span");
    atraso.className = resumo.emAtraso ? "numero atencao" : "numero";
    atraso.textContent = resumo.atraso;
    const valores = [selo(resumo.plano), resumo.vencimento, selo(resumo.pagamento), atraso];
    for (const [indice, valor] of valores.entries()) {
      const celula = tr.insertCell();
      celula.setAttribute("role", "cell");
      const rotulo = document.createElement("span");
      rotulo.className = "rotulo";
      rotulo.setAttribute("aria-hidden", "true");
      rotulo.textContent = rotulos[indice + 1].textContent;
      celula.append(rotulo, valor);
    }
    const acao = document.createElement("button");
    acao.className = "neutro";
    acao.type = "button";
    acao.textContent = "Abrir";
    acao.setAttribute("aria-label", "Abrir " + empresa.nome);
    acao.onclick = () => edicao.abrir(empresa, acao);
    const acoes = tr.insertCell();
    acoes.setAttribute("role", "cell");
    acoes.append(acao);
    return tr;
  }

  async function carregar(destino) {
    const atual = ++versao;
    destinoAtual = destino;
    anterior.disabled = proxima.disabled = true;
    el("total").hidden = true;
    mostrar("carregando");
    try {
      const { empresas, tem_proxima } = await listar(termo, destino);
      if (atual !== versao) return;
      pagina = destino;
      el("pagina").textContent = "Página " + pagina;
      el("total-pagina").textContent = empresas.length;
      el("total").hidden = false;
      corpo.replaceChildren(...empresas.map(linha));
      el("ajuda-vazio").hidden = !termo;
      el("limpar-busca").hidden = !termo;
      mostrar(empresas.length ? "rolagem" : "vazio");
      anterior.disabled = pagina <= 1;
      proxima.disabled = !tem_proxima;
    } catch (e) {
      if (atual !== versao) return;
      if ([401, 403].includes(e.status)) sair();
      else {
        erro.textContent = e.message;
        mostrar("falha");
      }
    }
  }

  busca.onsubmit = evento => {
    evento.preventDefault();
    termo = busca.elements.termo.value.trim();
    void carregar(1);
  };
  anterior.onclick = () => carregar(pagina - 1);
  proxima.onclick = () => carregar(pagina + 1);
  el("repetir-lista").onclick = () => carregar(destinoAtual);
  el("limpar-busca").onclick = () => {
    termo = "";
    busca.reset();
    busca.elements.termo.focus();
    void carregar(1);
  };

  return {
    abrir() {
      painel.hidden = false;
      el("titulo-inventario").focus();
      void carregar(1);
    },
    fechar() {
      versao++;
      termo = "";
      busca.reset();
      painel.hidden = true;
      corpo.replaceChildren();
      edicao.fechar();
    }
  };
}
