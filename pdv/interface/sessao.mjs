import { entrar, confirmarSenhaAtual, carregarVinculosPdv } from "../dados/sessao.mjs";
import { preencherSeletorLojas } from "../../equipe/interface/seletor-loja.mjs";
import { lojaInicial } from "../../equipe/regras/loja-inicial.mjs";
import { carregarCozinha } from "../../cozinha.mjs";
import { carregarAjustesCaixa } from "../../ajustes-caixa.mjs";
import { limparLojaPdv } from "./limpar-loja.mjs";

export function configurarSessao(ctx) {
  const { el, operar, atualizar, carregarComandas, carregarAcertos } = ctx;
  const seletor = el("empresa");
  const dialogo = el("troca-loja-pdv");
  const formulario = dialogo.querySelector("form");
  const senha = formulario.elements.senha;
  const aviso = el("aviso-troca-loja");
  let email, ativa, anterior, destino;

  async function vinculos() {
    const [empresas, vinculos] = await carregarVinculosPdv();
    ctx.setEmpresasGerenciadas(new Set(vinculos.map(vinculo => vinculo.empresa_id)));
    return ctx.area() === "administracao" ? empresas.filter(e => ctx.empresasGerenciadas().has(e.id)) : empresas;
  }

  async function abrir(empresa) {
    seletor.value = empresa;
    try { await atualizar(); }
    catch (erro) {
      seletor.value = "";
      limparLojaPdv(ctx);
      throw erro;
    }
    ativa = empresa;
    el("area-vendas").hidden = ctx.area() !== "vendas";
    el("area-administracao").hidden = ctx.area() !== "administracao";
    if (ctx.area() === "vendas") {
      void carregarCozinha();
      void carregarComandas();
      void carregarAjustesCaixa();
      void carregarAcertos();
    }
    return "Estabelecimento carregado.";
  }

  el("login").addEventListener("submit", evento => {
    evento.preventDefault();
    void operar(async () => {
      email = el("email").value.trim();
      try { ctx.setUsuario(await entrar(email, el("password").value)); }
      finally { el("password").value = ""; }
      el("operador-frente").textContent = "Operador · " + email;
      ctx.setArea(el("entrada").value);
      const lojas = await vinculos();
      const solicitada = new URLSearchParams(location.search).get("empresa_id");
      const inicial = lojaInicial(lojas, solicitada);
      preencherSeletorLojas(seletor, lojas);
      if (!lojas.length) return "Seu usuário ainda não tem acesso a um estabelecimento nesta área.";
      el("login").hidden = true;
      el("operacao").hidden = false;
      return inicial ? abrir(inicial) : "Escolha um estabelecimento para entrar.";
    });
  });

  seletor.addEventListener("change", () => {
    const escolhida = seletor.value;
    if (!escolhida || escolhida === ativa || dialogo.open) return;
    if (!ativa) { void operar(() => abrir(escolhida)); return; }
    if (ctx.ocupado()) { seletor.value = ativa; return; }
    destino = escolhida;
    anterior = ativa;
    ativa = undefined;
    seletor.value = "";
    limparLojaPdv(ctx);
    formulario.reset();
    el("destino-troca-loja").textContent = [...seletor.options].find(o => o.value === destino)?.textContent;
    aviso.textContent = "";
    dialogo.showModal();
  });

  formulario.onsubmit = evento => {
    evento.preventDefault();
    if (formulario.inert) return;
    formulario.inert = true;
    aviso.textContent = "";
    void operar(async () => {
      try {
        await confirmarSenhaAtual(email, senha.value);
        const lojas = await vinculos();
        if (!lojas.some(loja => loja.id === destino)) {
          dialogo.close();
          preencherSeletorLojas(seletor, lojas);
          return "Acesso indisponível para este estabelecimento. Escolha outra loja.";
        }
        const escolhida = destino;
        dialogo.close();
        preencherSeletorLojas(seletor, lojas);
        return await abrir(escolhida);
      } catch (erro) {
        if (!dialogo.open) throw erro;
        aviso.textContent = [400,401,403].includes(erro.status) ? "Senha inválida. Confira e tente novamente." : erro.message;
        return "";
      } finally {
        senha.value = "";
        formulario.inert = false;
      }
    });
  };
  function cancelar(evento) {
    evento.preventDefault();
    if (formulario.inert) return;
    senha.value = "";
    dialogo.close();
    void operar(() => abrir(anterior));
  }
  dialogo.oncancel = cancelar;
  el("cancelar-troca-loja").onclick = cancelar;
}
