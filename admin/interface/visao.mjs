import { ico } from "./icones-v1.mjs";
import { consultarVisao } from "../dados/visao.mjs";
import { estados, valor } from "../regras/pedidos.mjs";
import { meiaNoiteSP, periodo } from "../regras/periodo.mjs";

const canais = {pix:"Pix",credito:"Crédito",debito:"Débito",na_entrega:"Na entrega",dinheiro:"Dinheiro",cartao:"Cartão"};
const dataHora = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"medium",timeZone:"America/Sao_Paulo"});
const exibirDia = dia => dia.split("-").reverse().join("/");
const mensagens = {400:"Confira as datas. O período pode ter até 366 dias.",401:"Entre novamente para consultar.",403:"Somente gestores da loja podem consultar os indicadores."};

function linhas(lista,pares) {
  lista.replaceChildren(...pares.flatMap(([nome,valor])=>{
    const dt=document.createElement("dt"),dd=document.createElement("dd");
    dt.textContent=nome;
    dd.textContent=valor;
    return [dt,dd];
  }));
}

export function prepararVisao(area,{pedidos,catalogo}) {
  area.innerHTML = `
    <form class="acoes" aria-label="Período dos indicadores">
      <div><label for="visao-periodo">Período</label>
      <select id="visao-periodo" name="tipo"><option value="hoje">Hoje</option><option value="7">7 dias</option>
      <option value="30">30 dias</option><option value="personalizado">Personalizado</option></select></div>
      <label hidden>De <input name="inicio" type="date" required disabled></label>
      <label hidden>Até <input name="fim" type="date" required disabled></label>
      <button type="submit" hidden>Consultar</button>
    </form>
    <p role="status"></p>
    <div data-visao-resultados hidden>
      <div class="acoes"><button type="button" data-visao-pedidos>Ver pedidos do período</button>
      <button type="button" data-visao-catalogo>Ver produtos ativos nesta página</button></div>
      <div class="grade visao-grade">
        <dl class="metricas-painel" data-visao-totais aria-label="Indicadores"></dl>
        <section class="cartao"><h2>Pedidos por estado</h2><dl data-visao-estados></dl></section>
        <section class="cartao"><h2>Receita confirmada por canal</h2><dl data-visao-canais></dl></section>
      </div>
      <h2>Série diária</h2>
      <div class="rolagem"><table aria-label="Série diária"><thead><tr><th>Dia</th><th>Pedidos</th><th>Recebimentos</th>
      <th>Receita confirmada</th></tr></thead><tbody></tbody></table></div>
      <p data-visao-atualizacao></p>
    </div>`;
  const achar = s=>area.querySelector(s);
  const form=achar("form"), status=achar("[role=status]"), resultados=achar("[data-visao-resultados]");
  const {tipo,inicio,fim}=form.elements;
  let empresa, faixa, consulta=0;
  function mostrarCampos() {
    const custom=tipo.value==="personalizado";
    for (const campo of [inicio,fim]) {
      campo.disabled=!custom;
      campo.closest("label").hidden=!custom;
    }
    form.querySelector("button").hidden=!custom;
  }
  async function carregar() {
    const atual=++consulta;
    resultados.hidden=true;
    try {
      faixa=periodo(tipo.value,inicio.value,fim.value);
      status.textContent="Consultando indicadores…";
      const r=await consultarVisao(empresa,faixa);
      if (atual!==consulta) return;
      achar("[data-visao-totais]").replaceChildren(...[
        ["Pedidos",r.pedidos_total,"bag"],["Receita bruta confirmada",valor(r.receita_centavos),"wallet"],
        ["Aguardando confirmação online",r.pendentes_online,"clock"],["Ticket médio por recebimento",valor(r.ticket_medio_centavos),"activity"]
      ].map(([rotulo,valor,icone])=>{
        const card=document.createElement("div"), nome=document.createElement("dt"), total=document.createElement("dd");
        nome.textContent=rotulo;
        nome.insertAdjacentHTML("beforeend",ico(icone));
        total.textContent=valor;
        card.append(nome,total);
        return card;
      }));
      linhas(achar("[data-visao-estados]"),Object.entries(estados).map(([k,nome])=>[k==="entregue"?"Entregue":nome,r.por_estado[k]]));
      linhas(achar("[data-visao-canais]"),Object.entries(canais).map(([k,nome])=>[nome,valor(r.por_canal[k])]));
      achar("tbody").replaceChildren(...r.serie.map(d=>{
        const tr=document.createElement("tr");
        for (const x of [exibirDia(d.dia),d.pedidos,d.recebimentos,valor(d.receita_centavos)]) tr.insertCell().textContent=x;
        return tr;
      }));
      achar("[data-visao-atualizacao]").textContent="Atualizado às "+dataHora.format(new Date(r.atualizado_em));
      status.textContent=r.pedidos_total===0&&r.recebimentos_total===0?"Sem pedidos ou recebimentos no período.":"";
      resultados.hidden=false;
    } catch (e) {
      if (atual===consulta) status.textContent=mensagens[e.status]||(e.status===undefined&&e.message==="Confira as datas do período."
        ?e.message:"Não foi possível carregar os indicadores.");
    }
  }
  tipo.onchange=()=>{
    mostrarCampos();
    if (tipo.value!=="personalizado") return carregar();
    consulta++;
    resultados.hidden=true;
    status.textContent="";
  };
  form.onsubmit=e=>{e.preventDefault();carregar();};
  achar("[data-visao-pedidos]").onclick=()=>pedidos(
    {inicio:faixa.inicio,fim:faixa.ultimoDia},{inicio:meiaNoiteSP(faixa.inicio),fim:meiaNoiteSP(faixa.fim)}
  );
  achar("[data-visao-catalogo]").onclick=catalogo;
  return loja=>{empresa=loja;form.reset();mostrarCampos();return carregar();};
}
