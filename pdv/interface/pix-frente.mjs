import { paraReais } from "../regras/moeda.mjs";
import { configurarPixPdv } from "../../pix-pdv.mjs";
import { carregarCozinha } from "../../cozinha.mjs";

export function configurarPixFrente(ctx) {
  const { el, reais, estado, carrinho, opcoesPagamento } = ctx;
  return configurarPixPdv({
    caixa: () => estado.sessao?.id,
    atualizar: (ativo, resultado) => {
      if (ativo) {
        ctx.abrirPagamento(false);
        ctx.setMeioSelecionado("Pix");
        el("titulo-pagamento-frente").textContent = "Pix automático";
        el("orientacao-frente").textContent = "A venda será registrada quando o Mercado Pago confirmar.";
        el("dinheiro-frente").hidden = true;
        el("detalhe-pagamento-frente").hidden = false;
      }
      if (resultado?.itens && !resultado.pedido && !carrinho.size) {
        for (const item of resultado.itens) {
          const produto = ctx.produtos().find((p) => p.id === item.produto_id);
          if (produto) carrinho.set(produto.codigo, item.quantidade);
        }
        if (resultado.desconto) el("valor-desconto").value = paraReais(resultado.desconto);
      }
      ctx.renderizar();
    },
    recebido: async (resultado) => {
      ctx.setComandaAberta(undefined);
      carrinho.clear();
      ctx.limparPagamento();
      ctx.renderizar();
      el("notice").textContent = "Pix confirmado · " + reais(resultado.valor);
      await ctx.atualizar();
      void ctx.carregarComandas();
      void carregarCozinha();
    },
    aoFechar: ({ confirmado, ativa }) => {
      const foco = confirmado
        ? el("search")
        : ativa
          ? el("retomar-pix-frente")
          : opcoesPagamento.find((opcao) => opcao.dataset.meioPdv === "Pix");
      foco?.focus({ preventScroll: true });
    },
  });
}
