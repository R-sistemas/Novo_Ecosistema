import { configurarSessao } from "./sessao.mjs";
import { configurarAdministracao } from "./administracao.mjs";

export function montarAcesso(ctx) {
  const { el, operar, atualizar, estado, carrinho, renderizar, temItens } = ctx;
  configurarSessao({
    el,
    operar,
    ocupado: ctx.ocupado,
    limparContexto: ctx.limparContexto,
    atualizar,
    estado,
    carrinho,
    editarProduto: ctx.editarProduto,
    limparPagamento: () => ctx.vendas().limparPagamento(),
    renderizar,
    carregarComandas: () => ctx.vendas().carregarComandas(),
    carregarAcertos: () => ctx.vendas().carregarAcertos(),
    setUsuario: (valor) => {
      ctx.setUsuario(valor);
    },
    setEmpresasGerenciadas: (valor) => {
      ctx.setEmpresasGerenciadas(valor);
    },
    empresasGerenciadas: ctx.empresasGerenciadas,
    setArea: (valor) => {
      ctx.setArea(valor);
    },
    area: ctx.area,
    setComandaAberta: (valor) => {
      ctx.setComandaAberta(valor);
    },
    setVendaPendente: (valor) => {
      ctx.setVendaPendente(valor);
    },
    setProdutos: (valor) => {
      ctx.setProdutos(valor);
    },
  });
  configurarAdministracao({
    el,
    operar,
    ocupado: ctx.ocupado,
    limparContexto: ctx.limparContexto,
    atualizar,
    temItens,
    vendaPendente: ctx.vendaPendente,
    terminais: ctx.terminais,
  });
}
