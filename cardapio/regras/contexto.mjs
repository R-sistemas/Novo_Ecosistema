export function criarContexto(busca) {
  const parametros = new URLSearchParams(busca);
  const p_slug = parametros.get("loja");
  const p_mesa = parametros.get("mesa");
  const p_id = parametros.get("pedido");
  const tentativa = undefined;
  const ocupado = false;
  const aguardandoPix = false;
  const acompanhamentoAtivo = false;
  const pixTeste = p_slug === "loja-teste";
  const creditoTeste = pixTeste && parametros.get("cartao") === "credito";
  const entregaTeste = pixTeste && !p_mesa && !creditoTeste && parametros.get("entrega") === "teste";
  const entregaQuiosque = p_slug === "quiosque-dorafa" && !p_mesa && parametros.get("entrega") === "sim";
  const entrega = entregaTeste || entregaQuiosque;
  const creditoQuiosque = !entrega && p_slug === "quiosque-dorafa" && parametros.get("cartao") === "credito";
  const escolhaPublicaEntrega = p_slug === "quiosque-dorafa" && !p_mesa && !creditoTeste && !creditoQuiosque;
  const pixMercadoPagoTeste = entregaTeste || (pixTeste && parametros.get("pix") === "mercado-pago");
  const pixMercadoPagoQuiosque = p_slug === "quiosque-dorafa" &&
    (entregaQuiosque || parametros.get("pix") === "mercado-pago" || (!p_id && !parametros.has("pix")));
  const pixDisponivel = pixTeste;
  const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return {
    parametros,
    p_slug,
    p_mesa,
    p_id,
    tentativa,
    ocupado,
    aguardandoPix,
    acompanhamentoAtivo,
    pixTeste,
    creditoTeste,
    entregaTeste,
    entregaQuiosque,
    entrega,
    creditoQuiosque,
    escolhaPublicaEntrega,
    pixMercadoPagoTeste,
    pixMercadoPagoQuiosque,
    pixDisponivel,
    formaPagamento: "caixa",
    moeda,
    cotacao: { freteEntregaCentavos: null, enderecoCotado: null, temporizadorCotacao: null, sequenciaCotacao: 0 }
  };
}
