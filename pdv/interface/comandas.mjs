import { registrarRecebimento, listarComandas } from "../dados/comandas.mjs";

export function configurarComandas(ctx) {
  const {
    el,
    reais,
    meios,
    estado,
    carrinho,
    botao,
    operar,
    atualizar,
    carregarCozinha,
    limparPagamento,
    renderizar,
    atualizarTotalFrente,
    abrirPagamento,
  } = ctx;
  let consultaComandas = 0;
  let ultimaListaComandas;
  function receberPedido(id, meio, valorConferido) {
    return operar(async () => {
      if (!estado.sessao) throw new Error("Abra o caixa antes de receber o pedido.");
      if (!window.confirm("Registrar " + reais(valorConferido) + " em " + meio + "?")) return "";
      const valor = await registrarRecebimento({
        p_caixa: estado.sessao.id,
        p_pedido: id,
        p_meio: meios[meio],
        p_total: valorConferido,
      });
      if (ctx.comandaAberta()?.id === id) {
        ctx.setComandaAberta(undefined);
        limparPagamento();
      }
      await atualizar();
      void carregarCozinha();
      void carregarComandas();
      return "Recebimento registrado · " + reais(valor);
    });
  }
  el("fila-cozinha").addEventListener("receber-pedido", (evento) => {
    void receberPedido(evento.detail.id, el("meio-pedido-cozinha").value, evento.detail.total);
  });

  async function carregarComandas() {
    if (ctx.area() !== "vendas" || el("operacao").hidden) return;
    const atual = ++consultaComandas;
    const lista = el("comandas-pendentes");
    const empresa = el("empresa").value;
    if (!empresa || el("area-vendas").hidden) return;
    try {
      const comandas = await listarComandas({
        p_empresa: empresa,
        p_busca: el("buscar-comanda").value,
      });
      if (atual !== consultaComandas || empresa !== el("empresa").value) return;
      if (ctx.comandaAberta()) {
        const atualizada = comandas.find((c) => c.id === ctx.comandaAberta().id);
        if (atualizada) {
          ctx.setComandaAberta(atualizada);
          renderizar();
        } else {
          el("notice").textContent = "Comanda recebida ou indisponível. Volte ao balcão.";
          ctx.comandaAberta().adicionais_pendentes = true;
          atualizarTotalFrente();
        }
      }
      const resultado = JSON.stringify([empresa, comandas]);
      if (resultado === ultimaListaComandas) return;
      ultimaListaComandas = resultado;
      lista.replaceChildren(
        ...comandas.map((comanda) => {
          const linha = document.createElement("div");
          linha.className = "row";
          linha.append(
            "Mesa " +
              comanda.mesa +
              " · Comanda " +
              comanda.comanda +
              " · " +
              comanda.cliente +
              " · " +
              reais(comanda.total_centavos),
            botao("Carregar comanda", () => {
              if (carrinho.size || ctx.vendaPendente() || ctx.adicionalPendente()) {
                el("aviso-comandas").textContent = "Conclua ou esvazie a venda de balcão primeiro.";
                return;
              }
              ctx.setComandaAberta(comanda);
              el("dialogo-comandas").close();
              limparPagamento();
              renderizar();
              abrirPagamento();
            }),
          );
          return linha;
        }),
      );
      if (!comandas.length) lista.textContent = "Nenhuma comanda pendente para esta busca.";
    } catch (erro) {
      if (atual !== consultaComandas) return;
      ultimaListaComandas = undefined;
      lista.textContent = erro.message;
    }
  }
  el("operacao").addEventListener("invalidar-loja", () => {
    consultaComandas++;
    ultimaListaComandas = undefined;
    el("buscar-comanda").value = "";
  });
  el("buscar-comanda").oninput = carregarComandas;
  el("abrir-comandas").onclick = () => {
    el("aviso-comandas").textContent = "";
    el("dialogo-comandas").showModal();
    void carregarComandas();
  };
  el("fechar-comandas").onclick = () => el("dialogo-comandas").close();
  el("voltar-balcao").onclick = () => {
    if (ctx.adicionalPendente()) return;
    if (carrinho.size && !window.confirm("Descartar os adicionais ainda não enviados?")) return;
    carrinho.clear();
    ctx.setComandaAberta(undefined);
    limparPagamento();
    renderizar();
  };
  return { carregarComandas, receberPedido };
}
