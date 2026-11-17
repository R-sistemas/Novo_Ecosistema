export function configurarBuscaProdutos(ctx) {
  const { el, renderizarProdutos, adicionarProduto } = ctx;
  el("abrir-produtos").onclick = () => {
    el("buscar-produto-frente").value = "";
    renderizarProdutos();
    el("dialogo-produtos").showModal();
    el("buscar-produto-frente").focus();
  };
  el("fechar-produtos").onclick = () => el("dialogo-produtos").close();
  el("buscar-produto-frente").oninput = renderizarProdutos;
  el("search").addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    const busca = el("search").value.trim().toLocaleLowerCase("pt-BR");
    if (!busca) return;
    const exato = ctx.produtos().find((p) => p.codigo.toLocaleLowerCase("pt-BR") === busca);
    const candidatos = ctx.produtos().filter((p) => p.nome.toLocaleLowerCase("pt-BR").includes(busca));
    if (exato || candidatos.length === 1) adicionarProduto(exato ?? candidatos[0]);
  });
}
