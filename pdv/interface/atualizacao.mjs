import { configurarLicencaPdv } from "./licenca.mjs";
import { carregarDadosPdv } from "../dados/atualizar.mjs";
import { mapearMovimentos } from "../regras/movimentos.mjs";
import { saldo } from "../../caixa.mjs";

export function configurarAtualizacao(ctx) {
  const { el, estado, pixFrente, renderizar, renderizarCatalogoAdmin, carregarAparencia, carregarRecebimentosOnline } =
    ctx;

  const atualizarLicenca = configurarLicencaPdv({ el, estado, area: ctx.area, renderizar });

  async function atualizar() {
    void atualizarLicenca();
    const empresa = el("empresa").value;
    const administracao = ctx.area() === "administracao";
    const terminalAnterior = el("terminal-pdv").value;
    el("configuracao-entrega").hidden = true;
    const { catalogo, caixas, configuracao, terminais, pixDisponivel, registros } = await carregarDadosPdv({
      empresa,
      administracao,
      usuario: ctx.usuario(),
    });
    const nomePdv = configuracao[0].nome_pdv ?? configuracao[0].nome;
    el("nome-pdv-exibido").textContent = nomePdv;
    ctx.setTerminais(terminais);
    ctx.setAmbientePixFrente(pixDisponivel);
    if (administracao) {
      const config = configuracao[0];
      el("admin-nome-loja").textContent = config.nome;
      el("aparencia-cardapio").reset();
      el("cor-cardapio").value = config.cardapio_cor;
      el("fundo-cardapio").value = config.cardapio_fundo;
      el("previa-nome").textContent = config.nome;
      carregarAparencia(config);
      el("status").textContent = "Administração";
      el("nome-pdv").value = nomePdv;
      el("editar-terminal").replaceChildren(
        new Option("Novo caixa", ""),
        ...terminais.map((t) => new Option(t.nome + " · " + (t.email ?? "Sem operador ativo"), t.id)),
      );
      el("configurar-terminal").reset();
      el("cadastro-produto").hidden = false;
      el("pagamento-na-entrega").checked = config.pagamento_na_entrega;
      el("configuracao-entrega").hidden = false;
      ctx.setCatalogoAdmin(catalogo);
      renderizarCatalogoAdmin();
      return;
    }
    const caixa = caixas[0];
    el("terminal-pdv").replaceChildren(...terminais.map((t) => new Option(t.nome, t.id)));
    if (caixa && !caixa.fechado_em && !terminais.some((t) => t.id === caixa.terminal_id)) {
      el("terminal-pdv").add(new Option("Caixa do turno atual", caixa.terminal_id ?? ""));
    }
    el("terminal-pdv").value =
      caixa && !caixa.fechado_em
        ? (caixa.terminal_id ?? "")
        : terminais.some((t) => t.id === terminalAnterior)
          ? terminalAnterior
          : (terminais[0]?.id ?? "");
    ctx.setProdutos(catalogo.map((p) => ({ ...p, preco: Number(p.preco_centavos) })));
    const movimentos = mapearMovimentos(registros);
    const sessao = caixa && {
      id: caixa.id,
      abertura: Number(caixa.abertura_centavos),
      movimentos,
    };
    estado.sessao = caixa && !caixa.fechado_em ? sessao : null;
    estado.fechamentos = caixa?.fechado_em
      ? [
          {
            esperado: saldo(sessao),
            contado: Number(caixa.contado_centavos),
            movimentos,
          },
        ]
      : [];
    renderizar();
    void carregarRecebimentosOnline();
    if (estado.sessao)
      await pixFrente.recuperar().catch((erro) => {
        el("notice").textContent = erro.message;
      });
  }

  return atualizar;
}
