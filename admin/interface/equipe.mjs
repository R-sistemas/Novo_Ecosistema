import { consultarEquipe, criarOperador, mudarEquipe } from "../dados/equipe.mjs";

export function prepararEquipe(area, aoAvisar) {
  const encontrar = seletor => area.querySelector(seletor);
  const equipe = encontrar("[data-operadores]");
  const terminais = encontrar("[data-terminais]");
  const cadastro = encontrar("[data-cadastro]");
  const terminal = encontrar("[data-terminal]");
  const nomePdv = encontrar("[data-nome-pdv]");
  const erro = encontrar("[data-erro-equipe]");
  const campos = [...area.querySelectorAll("fieldset")];
  let empresa, versao = 0;
  let dados;
  let ocupado = false;

  function preencher() {
    equipe.replaceChildren(...dados.operadores.map(operador => {
      const item = document.createElement("li");
      const descricao = document.createElement("span");
      descricao.textContent = operador.email + " · Vínculo ativo · " + (operador.caixas?.join(", ") || "Sem caixa");
      const remover = document.createElement("button");
      remover.type = "button";
      remover.textContent = "Remover";
      remover.setAttribute("aria-label", "Remover " + operador.email);
      remover.onclick = () => {
        if (confirm("Revogar o acesso deste operador à loja?")) {
          operar(loja => mudarEquipe(loja,"remover",{email:operador.email}),"Acesso à loja removido.");
        }
      };
      item.append(descricao, remover);
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
    terminal.elements.email.replaceChildren(...dados.operadores.map(o=>new Option(o.email,o.email)));
    terminal.querySelector("button").disabled = dados.operadores.length === 0;
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
    for (const botao of equipe.querySelectorAll("button")) botao.disabled = bloqueado;
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
    terminal.reset();
    nomePdv.reset();
    bloquear(true);
    try {
      const resposta = await consultarEquipe(loja);
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
  cadastro.onsubmit = evento => {
    evento.preventDefault();
    const e = cadastro.elements;
    operar(loja => criarOperador(loja,{email:e.email.value.trim(),senha:e.senha.value,caixa:e.caixa.value.trim()}),"Operador cadastrado.");
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
