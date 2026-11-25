import { operarDesligamento } from "../dados/desligamento.mjs";
import { paraCentavos, paraReais } from "../../pdv/regras/moeda.mjs";

const moeda = new Intl.NumberFormat("pt-BR", {style:"currency", currency:"BRL"});

function botao(titulo, acao, tipo = "button") {
  const controle = document.createElement("button");
  controle.type = tipo;
  controle.textContent = titulo;
  if (acao) controle.onclick = acao;
  return controle;
}

export function prepararDesligamentos(painel, recarregarEquipe) {
  const lista = painel.querySelector("ul");
  const aviso = painel.nextElementSibling;
  let versao = 0, loja, ocupado = false;

  async function operar(acao, dados, sucesso) {
    if (!loja || ocupado) return;
    const atual = versao;
    const empresa = loja;
    ocupado = true;
    aviso.textContent = "";
    try {
      const resultado = await operarDesligamento(empresa, acao, dados);
      if (atual !== versao) return;
      await recarregarEquipe();
      if (empresa === loja) aviso.textContent = sucesso(resultado);
    } catch (erro) {
      if (atual === versao) aviso.textContent = erro.message;
    } finally {
      if (atual === versao) ocupado = false;
    }
  }

  function linha(suspenso) {
    const item = document.createElement("li");
    item.textContent = suspenso.email + " · " + suspenso.motivo;
    if (!suspenso.caixa) {
      item.append(" ", botao("Concluir desligamento", () => {
        if (confirm("Concluir o desligamento de " + suspenso.email + " nesta loja?")) {
          void operar("desvincular",{id:suspenso.id},() => "Desligamento concluído.");
        }
      }));
      return item;
    }
    const form = document.createElement("form");
    const label = document.createElement("label");
    const contado = document.createElement("input");
    contado.type = "number";
    contado.min = "0";
    contado.step = "0.01";
    contado.required = true;
    label.append((suspenso.terminal || "Caixa") + " · Valor contado (R$) ", contado);
    form.append(label, botao("Fechar turno assistido", null, "submit"));
    form.onsubmit = evento => {
      evento.preventDefault();
      if (!confirm("Confirmar o fechamento em nome da gestão da loja?")) return;
      void operar("reconciliar",{id:suspenso.id,caixa:suspenso.caixa,contado:paraCentavos(contado.valueAsNumber)},
        r => "Turno fechado. Dinheiro esperado: " + moeda.format(paraReais(r.esperado)) + ".");
    };
    item.append(form);
    return item;
  }

  async function carregar(empresa) {
    const atual = ++versao;
    loja = empresa;
    ocupado = false;
    aviso.textContent = "";
    lista.replaceChildren();
    painel.hidden = true;
    if (!empresa) return;
    const dados = await operarDesligamento(empresa, "listar");
    if (atual !== versao) return;
    lista.replaceChildren(...dados.map(linha));
    painel.hidden = !dados.length;
  }

  return {
    carregar,
    suspender(email) {
      return botao("Suspender acesso", () => {
        const motivo = prompt("Motivo da suspensão de " + email + " nesta loja", "");
        if (motivo?.trim()) void operar("suspender",{email,motivo:motivo.trim()},() => "Acesso suspenso nesta loja.");
      });
    }
  };
}
