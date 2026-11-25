export function vigiarVinculos({ empresa, versao, consultar, revogado, revisao = () => undefined }) {
  let consultando = false;
  async function verificar() {
    const loja = empresa();
    if (!loja || consultando || document.hidden) return;
    const atual = versao();
    const vinculo = revisao();
    consultando = true;
    try {
      const lojas = await consultar();
      if (atual === versao() && empresa() === loja && !lojas.some(item => item.id === loja && item.revisao === vinculo)) revogado(lojas);
    } catch (erro) {
      if (erro.status === 401 && atual === versao() && empresa() === loja) revogado([]);
    } finally { consultando = false; }
  }
  window.addEventListener("acesso-negado", verificar);
  document.addEventListener("visibilitychange", verificar);
  setInterval(verificar, 5000);
}
