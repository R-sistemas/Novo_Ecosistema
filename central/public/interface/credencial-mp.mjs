import { lerRecebedorMP, aprovarRecebedorMP } from "../dados/central.mjs";

export function controlesRecebedorMP(detalhe, sair, bloquear) {
  const bloco = document.createElement("section");
  bloco.className = "painel conteudo campos";
  bloco.innerHTML = `<h2>Conta Mercado Pago de pedidos</h2>
    <p role="status"></p>
    <form class="campos" hidden>
      <label>Canal de confirmação <select name="canal" required>
        <option value="">Escolha</option><option value="telefone">Telefone</option>
        <option value="email">E-mail</option><option value="whatsapp">WhatsApp</option>
      </select></label>
      <label>Motivo <textarea name="motivo" maxlength="240" required></textarea></label>
      <label><input type="checkbox" required> Confirmei a identidade por um contato já conhecido.</label>
      <button type="submit">Aprovar novo recebedor</button>
    </form>`;
  detalhe.append(bloco);
  const aviso = bloco.querySelector("p");
  const form = bloco.querySelector("form");
  const botao = form.querySelector("button");
  let versao = 0;
  let status;
  let empresa;

  function falha(erro) {
    if ([401, 403].includes(erro.status)) sair();
    else aviso.textContent = erro.message;
  }

  async function abrir(registro) {
    const atual = ++versao;
    empresa = registro?.id;
    status = null;
    form.hidden = true;
    form.reset();
    if (!empresa) return;
    aviso.textContent = "Consultando configuração…";
    try {
      const dados = await lerRecebedorMP(empresa);
      if (versao !== atual) return;
      status = dados;
      aviso.textContent = (dados.configurado ? "Conta configurada." : "Sem conta configurada.") +
        (dados.pendente ? " Aprovação pendente do recebedor " + dados.recebedor_pendente + "." : "");
      form.hidden = !dados.pendente;
    } catch (erro) {
      if (versao === atual) falha(erro);
    }
  }

  form.onsubmit = async evento => {
    evento.preventDefault();
    const atual = versao;
    const dados = Object.fromEntries(new FormData(form));
    botao.disabled = true;
    bloquear(true);
    try {
      await aprovarRecebedorMP(empresa, { ...dados, integracao: status.pendente, revisao: status.revisao });
      if (versao === atual) await abrir({ id: empresa });
    } catch (erro) {
      if (versao === atual) falha(erro);
    } finally {
      botao.disabled = false;
      bloquear(false);
    }
  };
  return abrir;
}
