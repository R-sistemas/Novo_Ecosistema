import { prepararConvites } from "./gerenciar-convites.mjs";

export function configurarFormularioConvites(formulario, painel) {
  const convites = prepararConvites(painel);
  const senha = formulario.querySelector('input[type=password]');
  const enviar = formulario.querySelector('button[type=submit],button:not([type])');
  const titulo = formulario.querySelector("legend,h2");
  let dados, versao = 0;

  async function carregar(empresa) {
    const atualVersao = ++versao;
    dados = undefined;
    formulario.reset();
    if (!empresa) { await convites.carregar(); return; }
    formulario.inert = true;
    try {
      const atual = await convites.carregar(empresa);
      if (!atual || atualVersao !== versao) return;
      dados = atual;
      senha.disabled = !atual.legado;
      senha.closest("label").hidden = !atual.legado;
      const rotulo = atual.legado ? "Cadastrar operador" : "Convidar operador";
      titulo.textContent = enviar.textContent = rotulo;
      enviar.hidden = !atual.legado && !atual.habilitado;
    } finally { if (atualVersao === versao) formulario.inert = false; }
  }

  return {
    carregar,
    async enviar(entrada, cadastroLegado) {
      if (!dados) return;
      if (dados.legado) return cadastroLegado();
      if (!dados.habilitado) return;
      if (await convites.emitir(entrada)) formulario.reset();
    }
  };
}
