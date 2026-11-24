import { gravarCredencialMP, lerCredencialMP, revogarCredencialMP } from "../dados/credencial-mp.mjs";

export function prepararCredencialMP(area) {
  const bloco = document.createElement("details");
  bloco.className = "cartao credencial-mp";
  bloco.innerHTML = `<summary>Conta Mercado Pago para pedidos</summary>
    <h3 data-estado tabindex="-1"></h3>
    <p role="status"></p>
    <p data-webhook hidden><strong>URL de notificações do Mercado Pago</strong><code></code></p>
    <div class="acoes" data-acoes hidden>
      <button type="button" data-editar>Editar credenciais</button>
      <button type="button" class="secondary" data-atualizar>Atualizar situação</button>
      <button type="button" class="secondary" data-revogar>Revogar credencial ativa</button>
    </div>
    <form autocomplete="off" method="post" hidden>
      <p class="ajuda">Informe as novas credenciais. Uma troca de recebedor precisa de aprovação da Central.</p>
      <label>Access Token <input type="password" name="access_token" autocomplete="new-password" maxlength="512" required></label>
      <label>Segredo do webhook <input type="password" name="webhook_secret" autocomplete="new-password" maxlength="512" required></label>
      <label>Public Key <input name="chave_publica" maxlength="240" required></label>
      <div class="acoes">
        <button type="submit">Validar e salvar</button>
        <button type="button" class="secondary" data-cancelar>Cancelar</button>
      </div>
    </form>`;
  area.append(bloco);
  const titulo = bloco.querySelector("[data-estado]");
  const aviso = bloco.querySelector("[role=status]");
  const form = bloco.querySelector("form");
  const webhook = bloco.querySelector("[data-webhook]");
  const acoes = bloco.querySelector("[data-acoes]");
  const editar = bloco.querySelector("[data-editar]");
  const atualizar = bloco.querySelector("[data-atualizar]");
  const revogar = bloco.querySelector("[data-revogar]");
  const cancelar = bloco.querySelector("[data-cancelar]");
  let empresa, dados, versao = 0, gravando = false;

  function mostrar() {
    const pendente = dados.troca_pendente;
    titulo.textContent = pendente ? "Aguardando confirmação da Central"
      : dados.configurado ? "Dados configurados" : "Conta ainda não configurada";
    aviso.textContent = pendente
      ? dados.configurado ? "A credencial atual continua ativa enquanto a Central verifica a troca."
        : "Solicitação recebida. A Central precisa aprovar a credencial para ativá-la."
      : "";
    webhook.hidden = !dados.rota_webhook;
    webhook.querySelector("code").textContent = dados.rota_webhook ? location.origin +
      "/api/mercado-pago-empresa-webhook?integracao=" + dados.rota_webhook : "";
    editar.textContent = dados.configurado ? "Editar credenciais" : "Configurar conta";
    editar.hidden = pendente;
    revogar.hidden = !dados.configurado;
    atualizar.hidden = false;
    acoes.hidden = false;
  }

  function fecharFormulario() {
    form.reset();
    form.hidden = true;
  }

  async function consultar(focar = false, mensagem = "") {
    const atual = ++versao;
    dados = null;
    fecharFormulario();
    acoes.hidden = webhook.hidden = true;
    titulo.textContent = "Consultando configuração…";
    aviso.textContent = "";
    try {
      const resposta = await lerCredencialMP(empresa);
      if (atual !== versao) return;
      dados = resposta;
      mostrar();
      if (mensagem) aviso.textContent = [mensagem, aviso.textContent].filter(Boolean).join(" ");
    } catch {
      if (atual !== versao) return;
      titulo.textContent = "Configuração indisponível";
      aviso.textContent = [mensagem, "Atualize a situação para consultar a configuração."].filter(Boolean).join(" ");
      acoes.hidden = atualizar.hidden = false;
      editar.hidden = revogar.hidden = true;
    }
    if (focar) titulo.focus();
  }

  bloco.ontoggle = () => {
    if (bloco.open && empresa) void consultar();
    else {
      versao++;
      dados = null;
      acoes.hidden = webhook.hidden = true;
      fecharFormulario();
    }
  };

  atualizar.onclick = () => { if (!gravando) void consultar(true); };
  editar.onclick = () => {
    if (!dados || dados.troca_pendente || gravando) return;
    aviso.textContent = "";
    acoes.hidden = true;
    form.hidden = false;
    form.elements.access_token.focus();
  };
  cancelar.onclick = () => {
    fecharFormulario();
    mostrar();
    editar.focus();
  };

  async function alterar(operacao, mensagem, erroPadrao) {
    const atual = versao;
    gravando = true;
    for (const botao of bloco.querySelectorAll("button")) botao.disabled = true;
    aviso.textContent = "Aguarde…";
    try {
      const resultado = await operacao();
      if (atual === versao) await consultar(true, mensagem(resultado));
    } catch (erro) {
      if (atual !== versao) return;
      if (erro.status === 409) {
        await consultar(true, "A configuração mudou. Confira a situação atual.");
      } else {
        aviso.textContent = erro.status === 422 ? "Mercado Pago não confirmou a credencial." : erroPadrao;
      }
    } finally {
      gravando = false;
      for (const botao of bloco.querySelectorAll("button")) botao.disabled = false;
    }
  }

  form.onsubmit = evento => {
    evento.preventDefault();
    if (gravando || !dados || dados.troca_pendente) return;
    const credencial = Object.fromEntries(new FormData(form));
    form.reset();
    void alterar(() => gravarCredencialMP(empresa, { ...credencial, revisao: dados.revisao }),
      resultado => resultado.estado === "pendente" ? "" : "Credenciais salvas.",
      "Não foi possível salvar a configuração.");
  };

  revogar.onclick = () => {
    if (gravando || !dados?.configurado ||
        !window.confirm("Revogar a credencial ativa? Novos pedidos podem ficar sem pagamento online.")) return;
    void alterar(() => revogarCredencialMP(empresa, dados.revisao), () => "Credencial ativa revogada.",
      "Não foi possível revogar a credencial.");
  };

  return novaEmpresa => {
    if (empresa === novaEmpresa) {
      if (bloco.open && !gravando && form.hidden) void consultar();
      return;
    }
    versao++;
    empresa = novaEmpresa;
    dados = null;
    bloco.open = false;
    acoes.hidden = webhook.hidden = true;
    fecharFormulario();
  };
}
