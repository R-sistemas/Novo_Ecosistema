import { entrar, carregarVinculosPdv } from "../dados/sessao.mjs";
import { carregarCozinha } from "../../cozinha.mjs";
import { carregarAjustesCaixa, invalidarAjustesCaixa } from "../../ajustes-caixa.mjs";

export function configurarSessao(ctx) {
  const { el, operar, atualizar, estado, carrinho, limparPagamento, renderizar, carregarComandas, carregarAcertos } =
    ctx;
  el("login").addEventListener("submit", (evento) => {
    evento.preventDefault();
    operar(async () => {
      ctx.setUsuario(await entrar(el("email").value, el("password").value));
      el("operador-frente").textContent = "Operador · " + el("email").value;
      el("password").value = "";
      const [empresas, vinculos] = await carregarVinculosPdv();
      ctx.setEmpresasGerenciadas(new Set(vinculos.map((vinculo) => vinculo.empresa_id)));
      ctx.setArea(el("entrada").value);
      const disponiveis =
        ctx.area() === "administracao" ? empresas.filter((e) => ctx.empresasGerenciadas().has(e.id)) : empresas;
      if (!disponiveis.length) throw new Error("Seu usuário ainda não tem acesso a um estabelecimento nesta área.");
      el("empresa").replaceChildren(...disponiveis.map((e) => new Option(e.nome, e.id)));
      await atualizar();
      el("area-vendas").hidden = ctx.area() !== "vendas";
      el("area-administracao").hidden = ctx.area() !== "administracao";
      el("login").hidden = true;
      el("operacao").hidden = false;
      if (ctx.area() === "vendas") {
        void carregarCozinha();
        void carregarComandas();
        void carregarAjustesCaixa();
        void carregarAcertos();
      }
      return "Estabelecimento carregado.";
    });
  });

  el("empresa").addEventListener("change", () => {
    invalidarAjustesCaixa();
    if (ctx.area() === "vendas") void carregarAjustesCaixa();
    void operar(async () => {
      carrinho.clear();
      ctx.setComandaAberta(undefined);
      ctx.setVendaPendente(undefined);
      limparPagamento();
      el("resultado-mesa").hidden = true;
      ctx.editarProduto();
      estado.sessao = null;
      estado.fechamentos = [];
      ctx.setProdutos([]);
      if (ctx.area() === "vendas") {
        renderizar();
        void carregarCozinha();
        void carregarComandas();
        void carregarAcertos();
      }
      await atualizar();
      return "Estabelecimento carregado.";
    });
  });
}
