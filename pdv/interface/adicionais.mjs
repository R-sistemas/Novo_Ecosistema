import { adicionarItens } from "../dados/adicionais.mjs";
import { carregarCozinha } from "../../cozinha.mjs";

export function configurarAdicionais(ctx) {
  const { el, operar, estado, carrinho, limparPagamento, renderizar, carregarComandas } = ctx;
  el("salvar-adicionais").onclick = () =>
    operar(async () => {
      if (!estado.sessao || !ctx.comandaAberta() || !carrinho.size)
        throw new Error("Abra o caixa e selecione os adicionais.");
      if (!ctx.adicionalPendente())
        ctx.setAdicionalPendente({
          p_caixa: estado.sessao.id,
          p_pedido: ctx.comandaAberta().id,
          p_id: crypto.randomUUID(),
          p_itens: ctx
            .produtos()
            .filter((p) => carrinho.has(p.codigo))
            .map((p) => ({
              produto_id: p.id,
              quantidade: carrinho.get(p.codigo),
            })),
        });
      const resultado = await adicionarItens(ctx.adicionalPendente());
      ctx.setComandaAberta({
        ...ctx.comandaAberta(),
        ...resultado,
        adicionais_pendentes: true,
      });
      ctx.setAdicionalPendente(undefined);
      carrinho.clear();
      limparPagamento();
      renderizar();
      await carregarComandas();
      void carregarCozinha();
      return "Adicionais registrados. A cozinha recebe somente os novos itens que exigem preparo.";
    });
}
