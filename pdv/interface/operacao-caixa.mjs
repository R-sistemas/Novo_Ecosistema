import { paraCentavos } from "../regras/moeda.mjs";
import { abrirCaixa, fecharCaixa, movimentarCaixa } from "../dados/caixa.mjs";

export function configurarOperacaoCaixa({ el, estado, operar, atualizar, temItens }) {
  function operarCaixa(acao) {
    const campo = el("amount");
    if (!campo.reportValidity()) return;
    const valor = paraCentavos(campo.valueAsNumber);
    if (!Number.isSafeInteger(valor)) return;
    operar(async () => {
      const p_caixa = estado.sessao?.id;
      if (acao === "Abrir caixa") {
        const terminal = el("terminal-pdv").value;
        if (!terminal) throw new Error("Peça ao gestor para vincular um caixa à sua conta.");
        await abrirCaixa({
          p_empresa: el("empresa").value,
          p_abertura: valor,
          p_terminal: terminal,
        });
      } else if (acao === "Fechar caixa") {
        if (temItens()) throw new Error("Conclua ou esvazie a venda atual antes de fechar o caixa.");
        await fecharCaixa({ p_caixa, p_contado: valor });
      } else {
        await movimentarCaixa({
          p_caixa,
          p_tipo: acao.toLowerCase(),
          p_valor: valor,
        });
      }
      campo.value = "";
      await atualizar();
      return "Caixa atualizado.";
    });
  }

  return operarCaixa;
}
