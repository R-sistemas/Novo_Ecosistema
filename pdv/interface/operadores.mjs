import { listarOperadores, removerOperador } from "../dados/administracao.mjs";

export function configurarOperadores({ el, botao, operar, atualizar }) {
  async function carregarOperadores(apenasCozinha = false) {
    const empresa = el("empresa").value;
    const aviso = el(apenasCozinha ? "aviso-operadores-kds" : "aviso-lista-operadores");
    const lista = el(apenasCozinha ? "email-permissao-kds" : "operadores-da-loja");
    const salvar = el("permissao-kds").querySelector("button");
    const atualizarLista = el("atualizar-lista-operadores");
    const controle = apenasCozinha ? salvar : atualizarLista;
    controle.disabled = true;
    lista.replaceChildren();
    aviso.textContent = "Carregando equipe…";
    try {
      const operadores = await listarOperadores(empresa);
      if (empresa !== el("empresa").value) return;
      if (apenasCozinha) {
        const cozinha = operadores.filter((operador) => operador.cozinha);
        lista.replaceChildren(
          new Option("Selecione um operador", ""),
          ...cozinha.map(
            (operador) =>
              new Option(
                operador.email + (operador.edita_comanda ? " · pode ajustar comandas" : " · sem acesso a ajustes"),
                operador.email,
              ),
          ),
        );
        aviso.textContent = cozinha.length
          ? ""
          : "Cadastre um operador de Cozinha · KDS para configurar esta permissão.";
        salvar.disabled = !cozinha.length;
      } else {
        lista.replaceChildren(
          ...operadores.map((operador) => {
            const linha = document.createElement("li");
            linha.className = "row";
            const descricao = document.createElement("span");
            const email = document.createElement("strong");
            email.textContent = operador.email;
            const perfis = [];
            if (operador.vendas)
              perfis.push(
                operador.caixas.length ? `Vendas (${operador.caixas.join(", ")})` : "Vendas (sem caixa atribuído)",
              );
            if (operador.cozinha) perfis.push(operador.edita_comanda ? "Cozinha · ajustes autorizados" : "Cozinha");
            descricao.append(email, document.createElement("br"), perfis.join(" / "));
            linha.append(
              descricao,
              botao(
                "Remover da loja",
                () => {
                  if (
                    !window.confirm(
                      `Remover o acesso de ${operador.email} a esta loja? O histórico dos turnos será mantido.`,
                    )
                  )
                    return;
                  void operar(async () => {
                    await removerOperador(empresa, operador.email);
                    await carregarOperadores();
                    await atualizar();
                    return "Acesso à loja removido.";
                  });
                },
                true,
              ),
            );
            return linha;
          }),
        );
        aviso.textContent = operadores.length ? "" : "Nenhum operador cadastrado nesta loja.";
      }
    } catch (erro) {
      if (empresa === el("empresa").value) aviso.textContent = erro.message;
    } finally {
      if (!apenasCozinha) atualizarLista.disabled = false;
    }
  }
  el("atualizar-lista-operadores").onclick = () => carregarOperadores();
  return carregarOperadores;
}
