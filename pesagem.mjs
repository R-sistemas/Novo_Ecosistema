import { centavosPorPeso, paraCentavos, paraReais } from "./pdv/regras/moeda.mjs";

export function configurarPesagem(painel) {
  const modo = painel.querySelector("select");
  const entrada = painel.querySelector("input");
  const rotulo = painel.querySelector("[data-rotulo-pesagem]");
  const previa = painel.querySelector("output");
  const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  let precoQuilo;

  function atualizar() {
    const peso = modo.value === "peso";
    const valor = entrada.valueAsNumber;
    const centavos = peso ? centavosPorPeso(precoQuilo, valor) : paraCentavos(valor);
    previa.textContent = Number.isFinite(centavos) && centavos > 0 ? `Total estimado ${moeda.format(paraReais(centavos))}` : "";
  }

  function escolherModo() {
    const peso = modo.value === "peso";
    rotulo.textContent = peso ? "Peso em gramas" : "Valor total em reais";
    entrada.min = peso ? "1" : "0.01";
    entrada.max = peso ? "100000" : "10000";
    entrada.step = peso ? "1" : "0.01";
    entrada.value = "";
    atualizar();
  }
  modo.onchange = escolherModo;
  entrada.oninput = atualizar;

  return {
    abrir(preco) {
      painel.hidden = preco == null;
      painel.disabled = painel.hidden;
      precoQuilo = Number(preco);
      modo.value = "peso";
      escolherModo();
    },
    dados() {
      const peso = modo.value === "peso";
      return { p_gramas: peso ? entrada.valueAsNumber : null, p_valor: peso ? null : paraCentavos(entrada.valueAsNumber) };
    }
  };
}

export const detalhePesagem = pesagem => pesagem.modo === "peso" ? `${pesagem.gramas} g` : "Valor digitado";
