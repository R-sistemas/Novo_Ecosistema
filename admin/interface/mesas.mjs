import { consultarMesas, gravarMesa } from "../dados/mesas.mjs";
import { linkDaMesa } from "../../cardapio/regras/link-mesa.mjs";
import { horario } from "../regras/pedidos.mjs";

const mensagens = {
  400:"Informe um número de mesa entre 1 e 999.",401:"Sua sessão terminou. Entre novamente.",
  403:"A operação exige um gestor da loja. Para criar mesas, o cardápio precisa estar publicado.",
  404:"Mesa indisponível nesta loja.",409:"Encerre as comandas da mesa antes de desativar."
};
const mensagem = e => mensagens[e.status] || "Não foi possível acessar as mesas.";

export function prepararMesas(area) {
  area.innerHTML = `
    <form class="acoes filtros-painel" aria-label="Criar mesa">
      <label>Número da mesa <input name="numero" type="number" min="1" max="999" step="1" required></label>
      <button type="submit" disabled>Criar mesa</button>
    </form>
    <p role="status"></p>
    <div class="rolagem"><table aria-label="Mesas da loja"><thead><tr>
      <th>Número</th><th>Status</th><th>Comandas abertas</th><th>Criação</th><th>Ações</th>
    </tr></thead><tbody></tbody></table></div>
    <dialog data-mesas-qr aria-labelledby="mesa-qr-titulo">
      <h2 id="mesa-qr-titulo"></h2>
      <img alt="QR Code do cardápio da mesa" width="196" height="196">
      <label>Link da mesa <input type="url" readonly></label>
      <div class="acoes">
        <button type="button" data-copiar>Copiar link</button><button type="button" data-imprimir>Imprimir QR</button>
        <button type="button" data-fechar>Fechar</button>
      </div>
      <p role="status"></p>
    </dialog>`;
  const achar = s => area.querySelector(s);
  const form=achar("form"), criar=form.querySelector("button"), corpo=achar("tbody");
  const status=achar("[role=status]"), dialogo=achar("dialog");
  const link=dialogo.querySelector("input"), qr=dialogo.querySelector("img");
  const retorno=dialogo.querySelector("[role=status]");
  let empresa,dados,sequencia=0,ocupado=false;

  async function mostrarQR(mesa) {
    const atual=sequencia;
    try {
      const {default:gerar}=await import("../../vendor/qrcode-generator/qrcode.mjs");
      if (atual!==sequencia || area.hidden) return;
      const codigo=gerar(0,"M");
      link.value=linkDaMesa({loja:dados.loja,mesa:mesa.mesa},location.href);
      codigo.addData(link.value);
      codigo.make();
      qr.src=codigo.createDataURL(4);
      dialogo.querySelector("h2").textContent="Mesa "+mesa.numero;
      retorno.textContent="";
      if (!dialogo.open) dialogo.showModal();
    } catch {
      if (atual===sequencia) status.textContent="Não foi possível gerar o QR da mesa.";
    }
  }
  dialogo.querySelector("[data-fechar]").onclick=()=>dialogo.close();
  dialogo.onclose=()=>{link.value="";qr.removeAttribute("src");};
  dialogo.querySelector("[data-copiar]").onclick=async()=>{
    try {await navigator.clipboard.writeText(link.value);retorno.textContent="Link copiado.";}
    catch {link.select();retorno.textContent="Selecione e copie o link da mesa.";}
  };
  dialogo.querySelector("[data-imprimir]").onclick=()=>window.print();

  function botao(texto,acao) {
    const el=document.createElement("button");
    el.type="button";
    el.textContent=texto;
    el.onclick=acao;
    return el;
  }
  function renderizar() {
    corpo.replaceChildren(...dados.mesas.map(mesa=>{
      const tr=document.createElement("tr");
      for (const v of [mesa.numero,mesa.ativo?"Ativa":"Inativa",mesa.comandas_abertas,
        mesa.criado_em?horario(mesa.criado_em):"Não registrada"]) tr.insertCell().textContent=v;
      const acoes=document.createElement("div");
      acoes.className="acoes";
      if (mesa.ativo && mesa.mesa && dados.loja) acoes.append(botao("Ver QR",()=>mostrarQR(mesa)));
      acoes.append(botao(mesa.ativo?"Desativar":"Reativar",()=>{
        const acao=mesa.ativo?"Desativar":"Reativar";
        if (confirm(acao+" a mesa "+mesa.numero+"?")) operar({acao:"situacao",numero:mesa.numero,ativo:!mesa.ativo});
      }));
      tr.insertCell().append(acoes);
      return tr;
    }));
  }
  function controles(habilitar) {
    criar.disabled=!habilitar;
    for (const el of corpo.querySelectorAll("button")) el.disabled=!habilitar;
  }
  async function operar(escrita) {
    if (ocupado) return;
    ocupado=true;
    const atual=++sequencia;
    controles(false);
    status.textContent=escrita?"Salvando mesa…":"Consultando mesas…";
    try {
      const r=await (escrita?gravarMesa(empresa,escrita):consultarMesas(empresa));
      if (atual!==sequencia) return;
      dados=r;
      renderizar();
      status.textContent=dados.mesas.length?"":"Nenhuma mesa cadastrada.";
      if (escrita?.acao==="criar") {
        const mesa=dados.mesas.find(m=>m.numero===escrita.numero);
        form.reset();
        if (mesa?.ativo && mesa.mesa && dados.loja) await mostrarQR(mesa);
        else status.textContent="Mesa já cadastrada. Reative para usar o QR.";
      }
    } catch (e) {
      if (atual===sequencia) status.textContent=mensagem(e);
    } finally {
      if (atual===sequencia) {ocupado=false;controles(true);}
    }
  }
  form.onsubmit=e=>{
    e.preventDefault();
    operar({acao:"criar",numero:form.elements.numero.valueAsNumber});
  };
  return loja=>{
    sequencia++;
    ocupado=false;
    empresa=loja;
    dados=undefined;
    corpo.replaceChildren();
    form.reset();
    return operar();
  };
}
