import { ico } from "./icones-v1.mjs";

const areas = {visao:["Visão geral","grid"],pedidos:["Pedidos","bag"],entregas:["Entregas","bag"],catalogo:["Catálogo","shopping"],
  mesas:["Mesas","box"],equipe:["Equipe e terminais","users"],preferencias:["Preferências","palette"]};

export function prepararNavegacao() {
  const menu = document.getElementById("menu-painel");
  const fundo = document.getElementById("fundo-menu");
  const barra = document.getElementById("lateral-painel");
  const mobile = matchMedia("(max-width: 850px)");
  const botoes = Object.keys(areas).map(nome=>[nome,document.getElementById("aba-"+nome)]);
  for (const [nome,botao] of botoes) botao.insertAdjacentHTML("afterbegin",ico(areas[nome][1]));
  function mostrar(aberto, devolverFoco = false) {
    barra.classList.toggle("aberta",aberto);
    barra.inert = mobile.matches && !aberto;
    fundo.hidden = !aberto;
    menu.setAttribute("aria-expanded",String(aberto));
    if (devolverFoco && mobile.matches) menu.focus();
  }
  menu.onclick = () => {
    const aberto = menu.getAttribute("aria-expanded") !== "true";
    mostrar(aberto,!aberto);
    if (aberto) barra.querySelector("select").focus();
  };
  fundo.onclick = () => mostrar(false,true);
  mobile.addEventListener("change",()=>mostrar(false));
  document.addEventListener("keydown",e=>{
    if (e.key === "Escape" && menu.getAttribute("aria-expanded") === "true") mostrar(false,true);
  });
  mostrar(false);
  return {
    revelar() { barra.hidden = menu.hidden = false; },
    selecionar(area) {
      for (const [nome,botao] of botoes) {
        const ativa = nome===area;
        document.getElementById("area-"+nome).hidden = !ativa;
        botao.setAttribute("aria-pressed",String(ativa));
        if (ativa) botao.setAttribute("aria-current","page");
        else botao.removeAttribute("aria-current");
      }
      document.getElementById("titulo-area").textContent=areas[area][0];
      document.getElementById("breadcrumb").textContent=areas[area][0];
      mostrar(false,barra.contains(document.activeElement));
    }
  };
}