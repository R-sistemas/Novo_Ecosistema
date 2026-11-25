import { invalidarAjustesCaixa } from "../../ajustes-caixa.mjs";
import { invalidarContextoLoja } from "../regras/contexto-loja.mjs";

export function limparLojaPdv(ctx) {
  const { el, estado, carrinho } = ctx;
  invalidarContextoLoja();
  invalidarAjustesCaixa();
  el("operacao").dispatchEvent(new Event("invalidar-loja"));
  for (const dialogo of document.querySelectorAll("dialog[open]")) dialogo.close();
  el("area-vendas").hidden = el("area-administracao").hidden = true;
  el("resultado-mesa").hidden = true;
  for (const id of ["catalogo-gestor","fila-cozinha","comandas-pendentes","acertos-pendentes",
    "recebimentos-online","resumo-online","lista-cancelamentos","lista-historico-cancelamentos",
    "operadores-da-loja","email-permissao-kds","terminal-pdv","editar-terminal","numero-acertos"]) {
    el(id).replaceChildren();
  }
  const licenca = el("licenca-pdv");
  if (licenca) licenca.hidden = true;
  el("nome-pdv-exibido").textContent = "R Sistemas";
  el("status").textContent = "";
  carrinho.clear();
  ctx.setComandaAberta(undefined);
  ctx.setVendaPendente(undefined);
  ctx.limparContexto();
  ctx.limparPagamento();
  ctx.editarProduto();
  estado.sessao = null;
  estado.fechamentos = [];
  estado.licencaBloqueada = false;
  ctx.renderizar();
}
