import { gravarCredencialMP, lerCredencialMP, revogarCredencialMP } from "../dados/credencial-mp.mjs";

export function prepararCredencialMP(area) {
  const bloco = document.createElement("details");
  bloco.className = "cartao";
  bloco.innerHTML = `<summary>Conta Mercado Pago para pedidos</summary>
    <p role="status"></p><p data-webhook hidden></p>
    <form autocomplete="off" hidden>
      <label>Access Token <input type="password" name="access_token" autocomplete="new-password" maxlength="512" required></label>
      <label>Segredo do webhook <input type="password" name="webhook_secret" autocomplete="new-password" maxlength="512" required></label>
      <label>Public Key <input name="chave_publica" maxlength="240" required></label>
      <button type="submit">Validar e salvar</button><button type="button" data-revogar hidden>Revogar credencial</button>
    </form>`;
  area.append(bloco);
  const status = bloco.querySelector("p");
  const form = bloco.querySelector("form");
  const webhook = bloco.querySelector("[data-webhook]");
  const botao = form.querySelector("button[type=submit]");
  const revogar = form.querySelector("[data-revogar]");
  let empresa, revisao, versao = 0;

  async function consultar() {
    const atual = ++versao;
    webhook.hidden = true;
    form.reset();
    form.hidden = true;
    status.textContent = "Consultando configuração…";
    try {
      const dados = await lerCredencialMP(empresa);
      if (atual !== versao) return;
      revisao = dados.revisao;
      webhook.hidden = !dados.rota_webhook;
      webhook.textContent = dados.rota_webhook ? "URL de notificações MP: " + location.origin +
        "/api/mercado-pago-empresa-webhook?integracao=" + dados.rota_webhook : "";
      status.textContent = dados.troca_pendente ? "Troca aguardando verificação da Central."
        : dados.configurado ? "Conta configurada." : "Conta ainda não configurada.";
      form.hidden = false;
      revogar.hidden = !dados.configurado;
    } catch {
      if (atual === versao) status.textContent = "Configuração indisponível. Feche e abra esta seção para tentar novamente.";
    }
  }

  bloco.ontoggle = () => {
    if (bloco.open && empresa) void consultar();
    else {
      versao++;
      webhook.hidden = true;
    form.reset();
      form.hidden = true;
    }
  };

  form.onsubmit = async evento => {
    evento.preventDefault();
    const atual = versao;
    const dados = Object.fromEntries(new FormData(form));
    botao.disabled = true;
    webhook.hidden = true;
    form.reset();
    try {
      await gravarCredencialMP(empresa, { ...dados, revisao });
      if (versao === atual) await consultar();
    } catch (erro) {
      if (versao === atual) status.textContent = erro.status === 422 ? "Mercado Pago não confirmou a credencial."
        : erro.status === 409 ? "A configuração mudou. Reabra esta seção."
        : "Não foi possível salvar a configuração.";
    } finally {
      botao.disabled = false;
    }
  };

  revogar.onclick = async () => {
    if (!window.confirm("Revogar a credencial Mercado Pago escolhida para novos pedidos?")) return;
    const atual = versao;
    botao.disabled = revogar.disabled = true;
    try {
      await revogarCredencialMP(empresa, revisao);
      if (atual === versao) await consultar();
    } catch {
      if (atual === versao) status.textContent = "Não foi possível revogar. Reabra esta seção para verificar o estado.";
    } finally {
      botao.disabled = revogar.disabled = false;
    }
  };
  return novaEmpresa => {
    if (empresa === novaEmpresa) return;
    versao++;
    empresa = novaEmpresa;
    bloco.open = false;
    webhook.hidden = true;
    form.reset();
    form.hidden = true;
  };
}
