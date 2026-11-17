export const precoAdicional = (comanda, produto) =>
  comanda?.itens.find((i) => i.produto_id === produto.id && !i.pesagem)?.preco_centavos ?? produto.preco;

export const subtotal = (pix, comanda, produtos, carrinho) =>
  pix?.itens
    ? pix.valor + pix.desconto
    : (comanda?.total_centavos ?? 0) +
      produtos.reduce(
        (soma, produto) => soma + precoAdicional(comanda, produto) * (carrinho.get(produto.codigo) ?? 0),
        0,
      );

export const desconto = (comanda, gerenciada, valor) => (!comanda && gerenciada ? Math.round((valor || 0) * 100) : 0);

export const total = (pix, subtotalCentavos, descontoCentavos) => pix?.valor ?? subtotalCentavos - descontoCentavos;

export const temItens = (comanda, quantidade, pix) => Boolean(comanda || quantidade || pix);
