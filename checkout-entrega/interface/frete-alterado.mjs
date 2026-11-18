import { moeda } from "../regras/pedido.mjs";

export function configurarFreteAlterado(ctx) {
  const alertaFrete = document.createElement("dialog");
  alertaFrete.className = "checkout-metodos";
  alertaFrete.innerHTML = `<div><h2>A taxa de entrega mudou</h2><p>Confira o novo total antes de confirmar. Nenhuma cobrança foi criada.</p><div id="checkout-diferenca-frete"></div><button type="button" id="checkout-aceitar-frete" class="primario largura">Aceitar novo valor</button></div>`;
  document.body.append(alertaFrete);
  function mostrarFreteAtualizado(novoFrete) {
    if (!Number.isSafeInteger(novoFrete) || novoFrete < 0) return ctx.aviso("Não foi possível confirmar o novo frete.");
    alertaFrete.querySelector("#checkout-diferenca-frete").innerHTML = `<div class="checkout-resumo"><div><span>Taxa anterior</span><b>${moeda(ctx.estado.frete)}</b></div><div><span>Nova taxa de entrega</span><b>${moeda(novoFrete)}</b></div><div class="checkout-total"><span>Novo total</span><b>${moeda(ctx.subtotal() + novoFrete)}</b></div></div>`;
    alertaFrete.querySelector("#checkout-aceitar-frete").onclick = () => {
      ctx.estado.frete = novoFrete;
      ctx.estado.cotacaoPino = ctx.estado.pino.maps_url;
      ctx.estado.tentativa = null;
      alertaFrete.close();
      ctx.render();
    };
    alertaFrete.showModal();
  }
  ctx.mostrarFreteAtualizado = mostrarFreteAtualizado;
}
