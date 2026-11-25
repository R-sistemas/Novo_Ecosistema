import { linkDaMesa } from "../../cardapio/regras/link-mesa.mjs";
import {
  cadastrarOperador, configurarMesa, configurarNomePdv, configurarEdicaoKds, configurarTerminal, configurarPagamentoNaEntrega,
} from "../dados/administracao.mjs";

import { configurarFormularioConvites } from "../../equipe/interface/formulario-convites.mjs";

export function configurarAdministracao(ctx) {
  const { el, operar, atualizar, temItens } = ctx;
  const formulario = el("cadastrar-operador");
  const convites = configurarFormularioConvites(formulario,el("convites-equipe-pdv"));
  formulario.addEventListener("abrir-convites", () => {
    void convites.carregar(el("empresa").value).then(() => el("novo-operador-perfil").onchange())
      .catch(() => { el("notice").textContent = "Não foi possível consultar os convites da loja."; });
  });
  el("configurar-mesa").onsubmit = (evento) => {
    evento.preventDefault();
    operar(async () => {
      const mesa = await configurarMesa({
        p_empresa: el("empresa").value,
        p_numero: el("numero-mesa").valueAsNumber,
      });
      el("link-mesa").value = linkDaMesa(mesa,location.href);
      el("resultado-mesa").hidden = false;
      return "Link da mesa disponível.";
    });
  };
  el("trocar-area").onclick = () => {
    if (temItens() || ctx.vendaPendente()) {
      el("notice").textContent = "Conclua ou esvazie a venda atual antes de trocar de área.";
      return;
    }
    location.reload();
  };
  el("configurar-pdv").onsubmit = (evento) => {
    evento.preventDefault();
    operar(async () => {
      await configurarNomePdv({
        p_empresa: el("empresa").value,
        p_nome: el("nome-pdv").value.trim(),
      });
      await atualizar();
      return "Nome do PDV atualizado.";
    }, true);
  };
  el("novo-operador-perfil").onchange = () => {
    el("novo-operador-terminal").hidden = el("novo-operador-perfil").value === "cozinha";
  };
  el("permissao-kds").onsubmit = (evento) => {
    evento.preventDefault();
    operar(async () => {
      await configurarEdicaoKds({
        p_empresa: el("empresa").value,
        p_email: el("email-permissao-kds").value.trim(),
        p_permitir: el("modo-permissao-kds").value === "conceder",
      });
      evento.target.reset();
      return "Permissão da cozinha atualizada.";
    }, true);
  };
  el("cadastrar-operador").onsubmit = (evento) => {
    evento.preventDefault();
    const empresa = el("empresa").value;
    const perfil = el("novo-operador-perfil").value;
    const entrada = {email:el("novo-operador-email").value.trim(), perfil,
      caixa:perfil === "vendas" ? el("novo-operador-caixa").value.trim() || null : null};
    void convites.enviar(entrada, () => {
      operar(async () => {
        const senha = el("novo-operador-senha");
        try { await cadastrarOperador({...entrada,empresa,senha:senha.value}); }
        finally { senha.value = ""; }
        formulario.reset();
        el("novo-operador-perfil").onchange();
        await atualizar();
        return "Operador cadastrado e vinculado ao estabelecimento.";
      }, true);
    }).finally(() => el("novo-operador-perfil").onchange());
  };
  el("editar-terminal").onchange = () => {
    const terminal = ctx.terminais().find((t) => t.id === el("editar-terminal").value);
    el("nome-terminal").value = terminal?.nome ?? "";
    el("email-operador").value = terminal?.email ?? "";
  };
  el("configurar-terminal").onsubmit = (evento) => {
    evento.preventDefault();
    operar(async () => {
      await configurarTerminal({
        p_empresa: el("empresa").value,
        p_terminal: el("editar-terminal").value || null,
        p_nome: el("nome-terminal").value.trim(),
        p_email: el("email-operador").value.trim(),
      });
      await atualizar();
      return "Caixa e operador configurados.";
    }, true);
  };

  el("cash").addEventListener("submit", (evento) => evento.preventDefault());
  el("configuracao-entrega").addEventListener("submit", (evento) => {
    evento.preventDefault();
    operar(async () => {
      await configurarPagamentoNaEntrega({
        p_empresa: el("empresa").value,
        p_habilitado: el("pagamento-na-entrega").checked,
      });
      return "Configuração de entrega salva.";
    }, true);
  });
}
