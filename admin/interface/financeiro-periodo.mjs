import { consultarFinanceiro } from "../dados/financeiro.mjs";
import { csvFinanceiro } from "../regras/financeiro-csv.mjs";
import { reais } from "./financeiro-formatacao.mjs";

const quantidade = (valor,singular,plural) => valor + " " + (valor === 1 ? singular : plural);

export function prepararFinanceiroPeriodo(area) {
  const botao = area.querySelector("[data-exportar]");
  const aviso = area.querySelector("[data-exportacao-status]");
  const reversoes = area.querySelector("[data-reversoes]");
  let contexto;

  function mostrarEstornos(dados) {
    if (!dados) return;
    const resumo = reversoes.querySelector("[data-reversoes-total]");
    resumo.textContent = dados.eventos_em_cobrancas
      ? quantidade(dados.estornos,"cobrança com estorno","cobranças com estorno") + " · " +
        quantidade(dados.cancelamentos,"cancelamento","cancelamentos") + " · " +
        quantidade(dados.contestacoes,"contestação","contestações")
      : "Sem observações do PSP neste período.";
    const valor = reversoes.querySelector("[data-reversoes-valor]");
    valor.textContent = dados.estornado_centavos != null
      ? "Valor estornado observado: " + reais(dados.estornado_centavos)
      : dados.sem_valor ? "Valor estornado indisponível para " + quantidade(dados.sem_valor,"cobrança","cobranças") + "." : "";
    const lista = reversoes.querySelector("[data-reversoes-provedores]");
    lista.replaceChildren(...Object.entries(dados.provedores).filter(([,p]) => p.estornos).map(([nome,p]) => {
      const li = document.createElement("li");
      li.textContent = nome + " · " + quantidade(p.estornos,"cobrança","cobranças") + " · " +
        (p.estornado_centavos == null ? "valor indisponível" : reais(p.estornado_centavos));
      return li;
    }));
    reversoes.hidden = false;
  }

  botao.onclick = async () => {
    const atual = contexto;
    if (!atual) return;
    botao.disabled = true;
    aviso.textContent = "Preparando CSV…";
    try {
      const dados = await consultarFinanceiro(atual.empresa,"exportar",atual.intervalo);
      if (atual !== contexto) return;
      if (dados.limite_excedido) {
        aviso.textContent = "O período tem mais de 5.000 transações. Selecione um intervalo menor.";
        return;
      }
      const blob = new Blob([csvFinanceiro(dados.transacoes)],{type:"text/csv;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "extrato-" + atual.intervalo.inicio + "-" + atual.intervalo.fim + ".csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      aviso.textContent = "CSV do período preparado.";
    } catch {
      if (atual === contexto) aviso.textContent = "Não foi possível exportar o extrato. Tente novamente.";
    } finally {
      if (atual === contexto) botao.disabled = false;
    }
  };

  return {
    mostrar(dados,empresa,intervalo) {
      contexto = {empresa,intervalo};
      botao.disabled = !dados.quantidade;
      mostrarEstornos(dados.reversoes);
    },
    limpar() {
      contexto = undefined;
      botao.disabled = true;
      aviso.textContent = "";
      reversoes.hidden = true;
    }
  };
}
