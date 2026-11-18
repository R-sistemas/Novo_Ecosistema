import { criarLocationPicker } from "../../location-picker.mjs";
import { criarEstadoCheckout } from "../regras/estado.mjs";
import { montarEndereco, montarEnderecoCotacao } from "../regras/pedido.mjs";
import { carregarDados, salvarDados } from "../dados/persistencia.mjs";
import { consultarMetodos } from "../dados/checkout.mjs";
import { montarEstrutura } from "./estrutura.mjs";
import { configurarApresentacao } from "./apresentacao.mjs";
import { configurarCotacao } from "./cotacao.mjs";
import { configurarFreteAlterado } from "./frete-alterado.mjs";
import { configurarEventos } from "./eventos.mjs";
import { configurarConfirmacao } from "./confirmacao.mjs";

export async function iniciarCheckoutEntrega(opcoes) {
  const dadosSalvos = carregarDados(opcoes.slug);
  const ctx = { ...opcoes, dadosSalvos, ...montarEstrutura(), estado: criarEstadoCheckout(dadosSalvos) };
  Object.assign(ctx, await consultarMetodos(ctx.slug));
  ctx.picker = criarLocationPicker({
    centro: ctx.menu.mapa_centro,
    inicial: ctx.estado.pino,
    aoSelecionar(pino) {
      ctx.estado.pino = pino;
      ctx.invalidarCotacao();
      ctx.conteudo.querySelector(".checkout-localizacao")?.classList.remove("checkout-localizacao-invalida");
      const resumoLocal = ctx.conteudo.querySelector(".checkout-localizacao p");
      if (resumoLocal) resumoLocal.textContent = "Destino selecionado. A taxa será calculada automaticamente.";
      ctx.atualizarResumo();
      ctx.agendarCotacao();
    }
  });
  ctx.reiniciarEstado = () => Object.assign(ctx.estado, criarEstadoCheckout(ctx.dadosSalvos));
  ctx.subtotal = () => ctx.carrinho.total();
  ctx.salvarDados = () => salvarDados(ctx.slug, ctx.estado);
  ctx.endereco = () => montarEndereco(ctx.estado);
  ctx.enderecoParaCotar = () => montarEnderecoCotacao(ctx.estado);
  configurarApresentacao(ctx);
  configurarCotacao(ctx);
  configurarFreteAlterado(ctx);
  configurarEventos(ctx);
  configurarConfirmacao(ctx);
}
