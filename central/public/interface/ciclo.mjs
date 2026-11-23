import { historicoLicenca, quitarLicenca } from "../dados/central.mjs";

export function controlesCiclo(concluir, sair, bloquear) {
  const form = document.getElementById("quitar-ciclo");
  const lista = document.getElementById("historico-licenca");
  const status = document.getElementById("estado-historico");
  const mais = document.getElementById("mais-historico");
  const erro = document.getElementById("erro-quitar");
  let empresa, tentativa, pagina, versao = 0;

  async function carregar() {
    const atual = versao;
    mais.disabled = true;
    status.textContent = "Carregando histórico…";
    try {
      const resultado = await historicoLicenca(empresa.id, pagina);
      if (atual !== versao) return;
      for (const evento of resultado.eventos) {
        const item = document.createElement("li");
        const antes = evento.antes?.revisao;
        const depois = evento.depois?.revisao;
        const revisao = depois ? " · Revisão " + (antes ? antes + " → " : "") + depois : "";
        const ciclo = evento.depois?.vencimento ? " · Vencimento " + evento.depois.vencimento : "";
        const quitacao = evento.depois?.vencimento_quitado
          ? " · Ciclo quitado " + evento.depois.vencimento_quitado + " · " + evento.depois.data_pagamento
            + " · " + (evento.depois.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          : "";
        item.textContent = new Date(evento.ocorrido_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          + " · " + evento.motivo + revisao + ciclo + quitacao;
        lista.append(item);
      }
      status.textContent = lista.childElementCount ? "" : "Sem eventos registrados.";
      pagina++;
      mais.hidden = !resultado.tem_proxima;
    } catch (e) {
      if (atual !== versao) return;
      if ([401, 403].includes(e.status)) sair();
      else {
        status.textContent = e.message;
        mais.hidden = false;
      }
    } finally {
      if (atual === versao) mais.disabled = false;
    }
  }

  mais.onclick = carregar;
  form.onsubmit = async evento => {
    evento.preventDefault();
    const atual = versao;
    const dados = { empresa: empresa.id, revisao: empresa.revisao, vencimento: empresa.vencimento,
      data_pagamento: form.elements.data.value, valor_centavos: Math.round(form.elements.valor.valueAsNumber * 100) };
    const assinatura = JSON.stringify(dados);
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, id: crypto.randomUUID() };
    bloquear(true);
    erro.textContent = "";
    try {
      await quitarLicenca({ ...dados, requisicao: tentativa.id });
      if (atual === versao) concluir();
    } catch (e) {
      if (atual !== versao) return;
      if ([401, 403].includes(e.status)) sair();
      else erro.textContent = e.message;
    } finally {
      if (atual === versao) bloquear(false);
    }
  };

  return registro => {
    versao++;
    empresa = registro;
    tentativa = undefined;
    pagina = 1;
    form.reset();
    lista.replaceChildren();
    status.textContent = erro.textContent = "";
    mais.hidden = true;
    form.hidden = !registro?.vencimento || registro.pagamento !== "pendente";
    if (!registro) return;
    document.getElementById("ciclo-confirmado").textContent = registro.vencimento ?? "";
    if (registro.preco_centavos != null) form.elements.valor.value = registro.preco_centavos / 100;
    void carregar();
  };
}
