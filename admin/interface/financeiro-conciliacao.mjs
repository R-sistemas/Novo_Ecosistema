import { consultarFinanceiro } from "../dados/financeiro.mjs";
import { periodoFinanceiroValido } from "../regras/financeiro.mjs";
import { horario, meios, reais } from "./financeiro-formatacao.mjs";

export function prepararConciliacao(area) {
  area.innerHTML = `
    <h2>Conciliação</h2>
    <p data-status role="status"></p><p data-erro class="erro" role="alert"></p>
    <button type="button" data-repetir hidden>Tentar novamente</button>
    <div data-resultados hidden>
      <div class="financeiro-cards">
        <section class="cartao"><h3>Confirmadas no sistema</h3><p data-confirmadas></p></section>
        <section class="cartao"><h3>Pendentes</h3><p data-pendentes></p></section>
        <section class="cartao"><h3>Divergências</h3><p data-divergencias></p></section>
        <section class="cartao"><h3>Estornos e cancelamentos</h3><p data-estornos></p></section>
      </div>
      <p data-cobertura></p>
      <section class="cartao">
        <h3>Cobranças pendentes</h3>
        <p data-criterio></p><p data-vazio role="status" hidden>Sem cobranças pendentes no período.</p>
        <div class="rolagem" tabindex="0" aria-label="Tabela de cobranças pendentes" data-tabela hidden>
          <table><thead><tr><th>Pedido criado em</th><th>Referência</th><th>Provedor</th>
            <th>Meio</th><th>Valor</th></tr></thead><tbody data-linhas></tbody></table>
        </div>
        <nav class="acoes" aria-label="Paginação das cobranças pendentes" data-paginacao hidden>
          <button type="button" data-anterior>Anterior</button>
          <span data-pagina aria-live="polite"></span>
          <button type="button" data-proxima>Próxima</button>
        </nav>
      </section>
    </div>`;
  const el = nome => area.querySelector("[data-" + nome + "]");
  let empresa, intervalo, versao = 0, pagina = 1;

  function exibir(dados) {
    el("confirmadas").textContent = dados.confirmadas + " · " + reais(dados.confirmadas_centavos);
    el("pendentes").textContent = dados.pendentes_total;
    el("divergencias").textContent = dados.divergencias ?? "Sem dados de webhook";
    el("estornos").textContent = dados.estornos_cancelamentos ?? "Sem dados de webhook";
    el("cobertura").textContent = dados.eventos_webhook
      ? dados.conciliadas + " cobranças conferidas com o PSP. Os totais de divergências e reversões cobrem os eventos recebidos no período."
      : "Confirmações registradas no sistema. A comparação com o PSP depende de eventos de webhook armazenados.";
    el("criterio").textContent = "Cobranças sem confirmação de pedidos criados há mais de " +
      dados.minutos_pendencia + " min. A data do pedido é usada como referência.";
    el("linhas").replaceChildren(...dados.pendentes.map(pendente => {
      const linha = document.createElement("tr");
      for (const texto of [horario.format(new Date(pendente.pedido_criado_em)),pendente.referencia,
        pendente.provedor,meios[pendente.meio] ?? pendente.meio,reais(pendente.valor_centavos)]) {
        linha.insertCell().textContent = texto;
      }
      return linha;
    }));
    el("vazio").hidden = dados.pendentes.length > 0;
    el("paginacao").hidden = !dados.pendentes_total && dados.pagina === 1;
    el("tabela").hidden = !dados.pendentes.length;
    el("pagina").textContent = "Página " + dados.pagina;
    el("anterior").disabled = dados.pagina <= 1;
    el("proxima").disabled = !dados.tem_proxima;
  }

  async function carregar(destino) {
    const atual = ++versao;
    pagina = destino;
    el("status").textContent = "Carregando conciliação…";
    el("erro").textContent = "";
    el("resultados").hidden = el("repetir").hidden = true;
    try {
      const dados = await consultarFinanceiro(empresa,"conciliacao",intervalo,destino);
      if (atual !== versao) return;
      exibir(dados);
      el("status").textContent = "";
      el("resultados").hidden = false;
    } catch {
      if (atual !== versao) return;
      el("status").textContent = "";
      el("erro").textContent = "Não foi possível carregar a conciliação.";
      el("repetir").hidden = false;
    }
  }

  function limpar() {
    versao++;
    el("status").textContent = el("erro").textContent = "";
    el("resultados").hidden = el("repetir").hidden = true;
  }

  el("anterior").onclick = () => carregar(pagina - 1);
  el("proxima").onclick = () => carregar(pagina + 1);
  el("repetir").onclick = () => carregar(pagina);
  return {
    limpar,
    atualizar(loja, datas) {
      limpar();
      empresa = loja;
      intervalo = datas;
      if (!periodoFinanceiroValido(datas.inicio,datas.fim,365)) {
        el("status").textContent = "Selecione até 365 dias para visualizar a conciliação.";
        return;
      }
      return carregar(1);
    }
  };
}
