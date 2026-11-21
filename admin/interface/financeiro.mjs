import { prepararConciliacao } from "./financeiro-conciliacao.mjs";
import { horario, meios, reais } from "./financeiro-formatacao.mjs";
import { consultarFinanceiro } from "../dados/financeiro.mjs";
import { periodo } from "../regras/periodo.mjs";
import { periodoFinanceiroValido } from "../regras/financeiro.mjs";

const canais = {cardapio:"Cardápio",entrega:"Entrega",pdv:"PDV"};
const estados = {pago:"Pago",entregue:"Entregue",recusado:"Recusado",cancelado:"Cancelado"};

function lista(elemento, totais, nomes = {}) {
  elemento.replaceChildren(...Object.entries(totais).flatMap(([chave,total]) => {
    const rotulo = document.createElement("dt");
    const valor = document.createElement("dd");
    rotulo.textContent = Object.hasOwn(nomes,chave) ? nomes[chave] : chave;
    valor.textContent = reais(total);
    return [rotulo,valor];
  }));
}

function grafico(elemento, dias) {
  const maximo = Math.max(1,...dias.map(dia => Number(dia.total_centavos)));
  elemento.replaceChildren(...dias.map(({dia,total_centavos}) => {
    const item = document.createElement("li");
    const barra = document.createElement("span");
    const data = document.createElement("time");
    data.dateTime = dia;
    data.textContent = dia.slice(5).split("-").reverse().join("/");
    item.setAttribute("aria-label", dia + " · " + reais(total_centavos));
    item.title = item.getAttribute("aria-label");
    barra.setAttribute("aria-hidden","true");
    barra.style.height = Math.max(1,100 * Number(total_centavos) / maximo) + "%";
    item.append(barra,data);
    return item;
  }));
}

export function prepararFinanceiro(area) {
  area.innerHTML = `
    <form class="cartao acoes" data-filtro>
      <label>Período <select name="tipo">
        <option value="hoje">Hoje</option><option value="7">7 dias</option>
        <option value="30">30 dias</option><option value="personalizado">Personalizado</option>
      </select></label>
      <a href="#conciliacao-financeiro">Ir para Conciliação</a>
      <div class="acoes" data-datas hidden>
        <label>Início <input name="inicio" type="date"></label>
        <label>Fim <input name="fim" type="date"></label>
        <button type="submit">Aplicar</button>
      </div>
    </form>
    <p data-status role="status"></p><p data-erro class="erro" role="alert"></p>
    <button data-repetir type="button" hidden>Tentar novamente</button>
    <div data-resultados hidden>
      <div class="financeiro-cards">
        <section class="cartao"><h2>Recebimentos</h2><dl data-total></dl></section>
        <section class="cartao"><h2>Por meio</h2><dl data-meios></dl></section>
        <section class="cartao"><h2>Por provedor</h2><dl data-provedores></dl></section>
        <section class="cartao"><h2>Por canal</h2><dl data-canais></dl></section>
      </div>
      <section class="cartao"><h2>Recebimentos diários</h2>
        <div class="rolagem" tabindex="0" aria-label="Gráfico diário"><ul class="financeiro-barras" data-grafico></ul></div>
      </section>
      <section class="cartao"><h2>Extrato</h2>
        <div class="rolagem" tabindex="0" aria-label="Tabela de extrato">
          <table><thead><tr><th>Confirmado em</th><th>Referência</th><th>Canal</th><th>Meio</th>
            <th>Provedor</th><th>Valor</th><th>Frete</th><th>Estado</th></tr></thead><tbody data-extrato></tbody></table>
        </div>
        <nav class="acoes" aria-label="Paginação do extrato">
          <button data-anterior type="button">Anterior</button><span data-pagina aria-live="polite"></span>
          <button data-proxima type="button">Próxima</button>
        </nav>
      </section>
    </div><section id="conciliacao-financeiro" data-conciliacao aria-label="Conciliação"></section>`;
  const el = nome => area.querySelector("[data-" + nome + "]");
  const conciliacao = prepararConciliacao(el("conciliacao"));
  const form = el("filtro");
  const {tipo,inicio,fim} = form.elements;
  let empresa, intervalo, resumo;
  let pagina = 1;
  let versao = 0;

  function mostrarResumo(dados) {
    const total = el("total");
    lista(total,{Total:dados.total_centavos,Frete:dados.frete_centavos});
    const quantidade = document.createElement("dt");
    const valor = document.createElement("dd");
    quantidade.textContent = "Transações";
    valor.textContent = dados.quantidade;
    total.append(quantidade,valor);
    lista(el("meios"),Object.fromEntries(Object.keys(meios).map(meio => [meio,dados.meios[meio] ?? 0])),meios);
    lista(el("provedores"),dados.provedores);
    lista(el("canais"),Object.fromEntries(Object.keys(canais).map(canal => [canal,dados.canais[canal] ?? 0])),canais);
    grafico(el("grafico"),dados.dias);
  }

  function mostrarExtrato(dados) {
    el("extrato").replaceChildren(...dados.transacoes.map(t => {
      const linha = document.createElement("tr");
      for (const texto of [horario.format(new Date(t.confirmado_em)),t.referencia,canais[t.canal],
        meios[t.meio],t.provedor,reais(t.valor_centavos),reais(t.frete_centavos),estados[t.estado] ?? t.estado]) {
        linha.insertCell().textContent = texto;
      }
      return linha;
    }));
    el("pagina").textContent = "Página " + dados.pagina;
    el("anterior").disabled = dados.pagina <= 1;
    el("proxima").disabled = !dados.tem_proxima;
  }

  async function carregar(destino) {
    const atual = ++versao;
    pagina = destino;
    el("status").textContent = "Carregando recebimentos…";
    el("erro").textContent = "";
    el("repetir").hidden = el("resultados").hidden = true;
    try {
      const [dados,extrato] = await Promise.all([
        resumo ?? consultarFinanceiro(empresa,"resumo",intervalo),
        consultarFinanceiro(empresa,"extrato",intervalo,destino)
      ]);
      if (atual !== versao) return;
      resumo = dados;
      mostrarResumo(dados);
      mostrarExtrato(extrato);
      el("status").textContent = dados.quantidade ? (extrato.transacoes.length ? "" : "Página sem transações.")
        : "Sem recebimentos no período";
      el("resultados").hidden = !dados.quantidade;
    } catch {
      if (atual !== versao) return;
      el("status").textContent = "";
      el("erro").textContent = "Não foi possível carregar os recebimentos.";
      el("repetir").hidden = false;
    }
  }

  function aplicar() {
    versao++;
    resumo = undefined;
    conciliacao.limpar();
    try {
      if (tipo.value === "personalizado" && !periodoFinanceiroValido(inicio.value,fim.value)) {
        throw new Error("Informe um período válido de até 366 dias.");
      }
      const datas = periodo(tipo.value,inicio.value,fim.value);
      intervalo = {inicio:datas.inicio,fim:datas.ultimoDia};
      void conciliacao.atualizar(empresa,intervalo);
      return carregar(1);
    } catch (erro) {
      el("status").textContent = "";
      el("erro").textContent = erro.message;
      el("repetir").hidden = el("resultados").hidden = true;
    }
  }

  tipo.onchange = () => {
    el("datas").hidden = tipo.value !== "personalizado";
    if (el("datas").hidden) aplicar();
  };
  form.onsubmit = evento => { evento.preventDefault(); aplicar(); };
  el("repetir").onclick = () => carregar(pagina);
  el("anterior").onclick = () => carregar(pagina - 1);
  el("proxima").onclick = () => carregar(pagina + 1);
  return {
    abrirLoja(id) { empresa = id; return aplicar(); },
    limpar() { versao++; conciliacao.limpar(); el("resultados").hidden = true; }
  };
}
