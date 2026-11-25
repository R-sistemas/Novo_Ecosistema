import { consultarEquipe, criarOperador, mudarEquipe } from "../dados/equipe.mjs";

import { configurarFormularioConvites } from "../../equipe/interface/formulario-convites.mjs";

export function prepararEquipe(area, aoAvisar) {
  const encontrar = seletor => area.querySelector(seletor);
  const equipe = encontrar("[data-operadores]");
  const terminais = encontrar("[data-terminais]");
  const cadastro = encontrar("[data-cadastro]");
  const convites = configurarFormularioConvites(cadastro,encontrar("[data-convites-painel]"));
  const terminal = encontrar("[data-terminal]");
  const nomePdv = encontrar("[data-nome-pdv]");
  const erro = encontrar("[data-erro-equipe]");
  const campos = [...area.querySelectorAll("fieldset")];
  let empresa, versao = 0;
  let dados;
  let ocupado = false;

  function atualizarPerfil() {
    const caixa = cadastro.elements.caixa;
    const vendas = cadastro.elements.perfil.value === "vendas";
    caixa.closest("label").hidden = !vendas;
    caixa.disabled = !vendas;
    caixa.required = vendas;
    if (!vendas) caixa.value = "";
  }

  function permissao(operador, acao, campo, titulo) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = operador[campo] === true;
    input.setAttribute("aria-label", titulo + " · " + operador.email);
    input.onchange = () => {
      const permitir = input.checked;
      input.checked = operador[campo] === true;
      operar(loja => mudarEquipe(loja,acao,{email:operador.email,permitir}),"Permissão atualizada.");
    };
    label.append(input, " " + titulo);
    return label;
  }

  function preencher() {
    equipe.replaceChildren(...dados.operadores.map(operador => {
      const item = document.createElement("li");
      const descricao = document.createElement("span");
      const badge = document.createElement("strong");
      badge.className = "perfil-equipe";
      badge.textContent = operador.vendas && operador.cozinha ? "Vendas e Cozinha" : operador.vendas ? "Vendas" : "Cozinha";
      descricao.append(operador.email, " ", badge);
      if (operador.vendas) descricao.append(" · " + (operador.caixas?.join(", ") || "Sem caixa"));
      const remover = document.createElement("button");
      remover.type = "button";
      remover.textContent = "Remover";
      remover.setAttribute("aria-label", "Remover " + operador.email);
      remover.onclick = () => {
        if (confirm("Revogar o acesso deste operador à loja?")) {
          operar(loja => mudarEquipe(loja,"remover",{email:operador.email}),"Acesso à loja removido.");
        }
      };
      const controles = document.createElement("div");
      controles.className = "acoes-equipe";
      if (operador.cozinha) controles.append(
        permissao(operador,"edicao_comanda","edita_comanda","Pode editar comanda"),
        permissao(operador,"contato_cliente","contato_cliente","Pode contatar cliente")
      );
      controles.append(remover);
      item.append(descricao, controles);
      return item;
    }));
    terminais.replaceChildren(...dados.terminais.map(t => {
      const item = document.createElement("li");
      const uso = t.ultimo_uso ? new Date(t.ultimo_uso).toLocaleString("pt-BR") : "Sem uso registrado";
      item.textContent = [t.nome,t.id,t.email || "Sem operador vinculado",uso].join(" · ");
      return item;
    }));
    encontrar("[data-sem-operadores]").hidden = dados.operadores.length !== 0;
    encontrar("[data-sem-terminais]").hidden = dados.terminais.length !== 0;
    terminal.elements.id.replaceChildren(new Option("Novo terminal",""),...dados.terminais.map(t=>new Option(t.nome,t.id)));
    const vendas = dados.operadores.filter(o => o.vendas);
    terminal.elements.email.replaceChildren(...vendas.map(o=>new Option(o.email,o.email)));
    terminal.querySelector("button").disabled = vendas.length === 0;
    terminal.elements.nome.value = "";
    nomePdv.elements.nome.value = dados.nome_pdv ?? "";
  }
  const mensagens = {
    400:"Confira os dados e feche turnos abertos antes de alterar vínculos.",
    401:"Sua sessão terminou. Entre novamente.",403:"Acesso restrito ao gestor da loja.",
    409:"Conta ou terminal indisponível. Confira a equipe antes de repetir."
  };
  const mostrarErro = falha => { erro.textContent = mensagens[falha.status] || "Não foi possível confirmar a operação. Confira a equipe antes de repetir."; };
  function bloquear(bloqueado) {
    ocupado = bloqueado;
    for (const grupo of campos) grupo.disabled = bloqueado;
    for (const botao of equipe.querySelectorAll("button,input")) botao.disabled = bloqueado;
  }
  async function carregar(loja) {
    const atual = ++versao;
    empresa = loja;
    dados = undefined;
    erro.textContent = "";
    equipe.replaceChildren();
    terminais.replaceChildren();
    encontrar("[data-sem-operadores]").hidden = true;
    encontrar("[data-sem-terminais]").hidden = true;
    cadastro.reset();
    atualizarPerfil();
    terminal.reset();
    nomePdv.reset();
    bloquear(true);
    try {
      const [resposta] = await Promise.all([consultarEquipe(loja),convites.carregar(loja)]);
      atualizarPerfil();
      if (atual !== versao) return;
      dados = resposta;
      preencher();
    } catch (falha) {
      if (atual === versao) mostrarErro(falha);
    } finally {
      if (atual === versao && dados) bloquear(false);
    }
  }
  async function operar(acao,sucesso) {
    if (ocupado || !dados) return;
    const atual = versao, loja = empresa;
    bloquear(true);
    erro.textContent = "";
    try {
      await acao(loja);
      if (atual !== versao) return;
      aoAvisar(sucesso);
      await carregar(loja);
    } catch (falha) {
      if (atual === versao) mostrarErro(falha);
    } finally {
      if (atual === versao) {
        cadastro.elements.senha.value = "";
        bloquear(false);
      }
    }
  }
  cadastro.elements.perfil.onchange = atualizarPerfil;
  cadastro.onsubmit = evento => {
    evento.preventDefault();
    const e = cadastro.elements;
    const entrada = {email:e.email.value.trim(),perfil:e.perfil.value,caixa:e.caixa.disabled ? null : e.caixa.value.trim()};
    void convites.enviar(entrada, () => {
      operar(loja => criarOperador(loja,{...entrada,senha:e.senha.value}),"Operador cadastrado.");
    }).finally(atualizarPerfil);
  };
  terminal.elements.id.onchange = () => {
    const t = dados?.terminais.find(item=>item.id===terminal.elements.id.value);
    terminal.elements.nome.value = t?.nome ?? "";
    if (t && dados.operadores.some(o=>o.email===t.email)) terminal.elements.email.value = t.email;
  };
  terminal.onsubmit = evento => {
    evento.preventDefault();
    const e = terminal.elements;
    operar(loja => mudarEquipe(loja,"terminal",{id:e.id.value || null,nome:e.nome.value.trim(),email:e.email.value}),"Terminal atualizado.");
  };
  nomePdv.onsubmit = evento => {
    evento.preventDefault();
    operar(loja => mudarEquipe(loja,"nome_pdv",{nome:nomePdv.elements.nome.value.trim() || null}),"Nome do PDV atualizado.");
  };
  return carregar;
}
