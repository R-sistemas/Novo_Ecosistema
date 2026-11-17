import {
  cadastrarOperador, configurarMesa, configurarNomePdv, configurarEdicaoKds, configurarTerminal, configurarPagamentoNaEntrega,
} from "../dados/administracao.mjs";

export function configurarAdministracao(ctx) {
  const { el, operar, atualizar, temItens } = ctx;
  el("configurar-mesa").onsubmit = (evento) => {
    evento.preventDefault();
    operar(async () => {
      const mesa = await configurarMesa({
        p_empresa: el("empresa").value,
        p_numero: el("numero-mesa").valueAsNumber,
      });
      const link = new URL("./cardapio.html", location.href);
      link.search = new URLSearchParams(mesa);
      el("link-mesa").value = link.href;
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
    operar(async () => {
      const senha = el("novo-operador-senha");
      const perfil = el("novo-operador-perfil").value;
      try {
        await cadastrarOperador({
          empresa: el("empresa").value,
          email: el("novo-operador-email").value.trim(),
          senha: senha.value,
          perfil,
          caixa: perfil === "vendas" ? el("novo-operador-caixa").value.trim() || null : null,
        });
      } finally {
        senha.value = "";
      }
      evento.target.reset();
      el("novo-operador-perfil").onchange();
      await atualizar();
      return perfil === "cozinha"
        ? "Conta exclusiva do KDS cadastrada."
        : "Operador cadastrado e vinculado ao estabelecimento.";
    }, true);
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
