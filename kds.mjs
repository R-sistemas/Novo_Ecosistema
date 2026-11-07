import { entrar, executar } from "./supabase-pdv.mjs";
import { carregarCozinha } from "./cozinha.mjs";
import { atualizarPermissaoKds } from "./editar-comanda-kds.mjs";

const el = id => document.getElementById(id);
el("login-kds").onsubmit = async evento => {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  formulario.inert = true;
  try {
    await entrar(el("email-kds").value, el("senha-kds").value);
    const lojas = await executar("lojas_kds", {});
    if (!lojas.length) throw new Error("Use uma conta de cozinha vinculada pelo gestor.");
    el("empresa").replaceChildren(...lojas.map(loja => new Option(loja.nome, loja.id)));
    el("operacao").hidden = false;
    formulario.hidden = true;
    el("login-aviso-kds").textContent = "";
    await Promise.all([carregarCozinha(), atualizarPermissaoKds()]);
  } catch (erro) {
    el("login-aviso-kds").textContent = erro.message;
  } finally {
    el("senha-kds").value = "";
    formulario.inert = false;
  }
};
el("empresa").onchange = () => {
  void carregarCozinha();
  void atualizarPermissaoKds();
};
