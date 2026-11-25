import { vigiaDaLoja } from "../regras/contexto-loja.mjs";
import { validarAcerto } from "../regras/acertos.mjs";
import { listarAcertos, confirmarAcerto } from "../dados/caixa.mjs";

export function configurarAcertos(ctx) {
  const { el, botao, reais, operar, atualizar, carregarCozinha, estado } = ctx;
  let acertoSelecionado;
  async function carregarAcertos() {
    if (ctx.area() !== "vendas" || el("operacao").hidden) return;
    const empresa = el("empresa").value;
    if (!empresa || el("area-vendas").hidden) return;
    const vigente = vigiaDaLoja(el("empresa"));
    const lista = el("acertos-pendentes");
    try {
      const pendentes = await listarAcertos(empresa);
      if (!vigente()) return;
      el("numero-acertos").textContent = pendentes.length ? `(${pendentes.length})` : "";
      lista.replaceChildren(
        ...pendentes.map((acerto) => {
          const linha = document.createElement("div");
          linha.className = "row";
          const detalhes = document.createElement("span");
          const metodo = acerto.metodo === "maquininha" ? "Cartão na maquininha" : "Dinheiro";
          detalhes.textContent = `Comanda ${acerto.comanda} · ${acerto.cliente} · ${reais(acerto.valor_centavos)} · ${metodo} · ${acerto.entregador?.nome || "Entregador"}`;
          linha.append(
            detalhes,
            botao("Conferir acerto", () => {
              acertoSelecionado = acerto;
              el("resumo-acerto").textContent =
                `Comanda ${acerto.comanda} · ${reais(acerto.valor_centavos)} · ${metodo}` +
                (acerto.comprovante ? ` · Comprovante declarado: ${acerto.comprovante}` : "");
              el("form-acerto").reset();
              el("grupo-comprovante-acerto").hidden = acerto.metodo !== "maquininha";
              el("grupo-maquininha-acerto").hidden = acerto.metodo !== "maquininha";
              el("erro-acerto").textContent = "";
              el("dialogo-acerto").showModal();
            }),
          );
          return linha;
        }),
      );
      if (!pendentes.length) lista.textContent = "Nenhum acerto pendente.";
      el("aviso-acertos").textContent = "";
    } catch (erro) {
      if (vigente()) el("aviso-acertos").textContent = erro.message;
    }
  }
  el("operacao").addEventListener("invalidar-loja", () => { acertoSelecionado = undefined; });
  el("atualizar-acertos").onclick = () => void carregarAcertos();
  el("fechar-acerto").onclick = () => el("dialogo-acerto").close();
  el("form-acerto").addEventListener("submit", (evento) => {
    evento.preventDefault();
    void operar(async () => {
      const acerto = acertoSelecionado;
      validarAcerto({
        caixa: estado.sessao,
        acerto,
        conferido: el("conferencia-acerto").checked,
        maquininhaDevolvida: el("maquininha-devolvida").checked,
      });
      const valor = await confirmarAcerto({
        p_caixa: estado.sessao.id,
        p_pedido: acerto.pedido_id,
        p_meio: acerto.metodo === "maquininha" ? "cartao" : "dinheiro",
        p_total: acerto.valor_centavos,
        p_comprovante: el("comprovante-acerto").value.trim() || null,
        p_maquininha_devolvida: el("maquininha-devolvida").checked,
      });
      acertoSelecionado = undefined;
      el("dialogo-acerto").close();
      await atualizar();
      void carregarAcertos();
      void carregarCozinha();
      return "Acerto confirmado · " + reais(valor);
    });
  });

  return carregarAcertos;
}
