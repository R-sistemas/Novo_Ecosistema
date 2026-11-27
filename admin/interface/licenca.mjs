import { confirmarSenhaAtual, executar, executarApi } from "../../supabase-pdv.mjs";
import { montarCartaoLicenca } from "./licenca-cartao.mjs";
import { mostrarMudancaLicenca } from "./licenca-mudanca.mjs";
const dataCivil = data => new Date(data).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"});
const reais = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const valor = centavos => reais.format(centavos / 100);
function texto(tag, conteudo) {
  const item = document.createElement(tag);
  item.textContent = conteudo;
  return item;
}
const nomes = {
  trial: "Período experimental", valida: "Licença válida", tolerancia: "Renovação pendente", restrita: "Acesso operacional encerrado",
  pendente: "Pagamento pendente", confirmado: "Confirmado", revisao: "Em conciliação", encerrado: "Encerrado",
  estornado: "Estornado", contestado: "Contestado"
};
function campo(descricao, tipo, preenchimento) {
  const rotulo = texto("label", descricao);
  const input = document.createElement("input");
  input.type = tipo;
  input.autocomplete = preenchimento;
  input.required = true;
  rotulo.append(input);
  return {rotulo, input};
}
function textoAviso(marco) {
  if (marco === "trial_d1") return "Seu período experimental começou.";
  if (marco === "trial_d5") return "Seu período experimental está chegando ao fim.";
  if (marco === "trial_d7") return "Último dia do seu período experimental.";
  if (marco === "renovacao_d0") return "A validade venceu e a renovação está pendente.";
  if (marco === "renovacao_d2") return "O pagamento da renovação está em atraso.";
  if (marco === "renovacao_d4") return "A licença será suspensa no próximo dia se a renovação continuar pendente.";
  if (marco.startsWith("renovacao_d-")) return "A renovação da licença está próxima.";
  if (marco.startsWith("exclusao_menos_")) return "Prazo até a exclusão dos dados operacionais: " + marco.split("_").at(-1) + " dias.";
}
export function prepararLicenca(area, atualizarResumo) {
  let versao = 0;
  function limpar() {
    versao++;
    area.hidden = true;
    area.replaceChildren();
  }
  async function abrir(empresa, resumo) {
    limpar();
    if (!resumo) return;
    const atual = versao;
    area.hidden = false;
    area.append(texto("h2", "Licença"), texto("p", nomes[resumo.situacao]));
    if (resumo.valido_ate) {
      area.append(texto("p", "Validade até " + resumo.valido_ate.split("-").reverse().join("/")));
    } else if (resumo.trial_fim) {
      area.append(texto("p", "Trial até " + new Date(resumo.trial_fim).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})));
    }
    if (resumo.retencao_ate && resumo.valido_ate) area.append(texto("p","Retenção até " + dataCivil(resumo.retencao_ate)));
    const status = texto("p", "");
    status.setAttribute("role", "status");
    const qr = document.createElement("textarea");
    qr.hidden = true;
    qr.readOnly = true;
    qr.setAttribute("aria-label", "Código Pix copia e cola");
    const refrescar = async () => { const novo = await resumoLicenca(empresa); if (versao === atual) await abrir(empresa,novo); };
    mostrarMudancaLicenca(area,empresa,resumo,refrescar);
    const botoes = [];
    async function pagar(dados, botao) {
      for (const controle of botoes) controle.disabled = true;
      status.textContent = "Consultando pagamento…";
      qr.hidden = true;
      qr.value = "";
      try {
        const operacao = dados.cobranca ? "licenca_consultar" : "licenca_pix";
        const resposta = await executarApi("mercado-pago-empresa?operacao_mp=" + operacao, {empresa, ...dados});
        if (versao !== atual) return;
        if (resposta?.pix) {
          qr.value = resposta.pix;
          qr.hidden = false;
        }
        status.textContent = nomes[resposta?.estado] ?? "Pagamento indisponível.";
        if (resposta?.estado === "pendente") botao.textContent = "Consultar cobrança";
        else {
          const atualizado = await resumoLicenca(empresa);
          if (versao === atual) {
            atualizarResumo(atualizado);
            await abrir(empresa, atualizado);
          }
        }
      } catch {
        if (versao === atual) status.textContent = "Não foi possível consultar a cobrança. Tente novamente.";
      } finally {
        if (versao === atual) for (const controle of botoes) controle.disabled = false;
      }
    }
    const pendente = resumo.historico.find(item => ["pendente","revisao"].includes(item.estado));
    if (pendente) {
      const botao = texto("button", "Consultar cobrança");
      botao.type = "button";
      botao.onclick = () => pagar(resumo.cobranca_ativa && pendente.retomar ? pendente.retomar : {cobranca:pendente.id}, botao);
      botoes.push(botao);
      area.append(botao);
    } else if (!pendente && resumo.fase !== "encerrada" && !resumo.nao_renovar) {
      for (const oferta of resumo.ofertas.filter(o => !resumo.mudanca || resumo.mudanca.paga || o.id===resumo.mudanca.oferta)) {
        const linha = document.createElement("div");
        const total = Math.max(1, Math.round(oferta.preco_centavos * (10000 - (oferta.desconto_pix_basis_points ?? 0)) / 10000));
        const periodo = oferta.meses === 1 ? "mensal" : "semestral";
        const aceite = document.createElement("input");
        aceite.type = "checkbox";
        const rotulo = texto("label", " Aceito os termos " + oferta.termos_versao);
        rotulo.prepend(aceite);
        const bloco = document.createElement("fieldset");
        bloco.append(texto("legend", oferta.plano + " · " + periodo + " · Pix " + valor(total)), rotulo);
        const botao = texto("button", "Gerar Pix");
        botao.type = "button";
        const dados = {oferta:oferta.id,termos:oferta.termos_versao,requisicao:crypto.randomUUID()};
        botao.onclick = () => {
          if (!aceite.checked) { status.textContent = "Confirme o aceite dos termos."; return; }
          void pagar(dados, botao);
        };
        botoes.push(botao);
        linha.append(bloco, botao);
        area.append(linha);
        if (oferta.meses === 6) montarCartaoLicenca(linha, {empresa, oferta:oferta.id, termos:oferta.termos_versao}, async () => {
          const atualizado = await resumoLicenca(empresa);
          if (versao === atual) await abrir(empresa, atualizado);
        });
      }
    }
    area.append(status, qr);
    const modo = resumo.fase === "trial" && resumo.situacao === "trial" ? "trial"
      : resumo.meses === 6 && resumo.situacao === "valida" && !resumo.nao_renovar ? "nao_renovar" : null;
    if (modo) montarCancelamento(modo);
    const avisos = await executar("loja_licenca_avisos", {p_empresa:empresa}).catch(() => []);
    if (versao === atual && avisos.length) {
      const lista = document.createElement("ul");
      for (const aviso of avisos) {
        const mensagem = textoAviso(aviso.marco);
        if (mensagem) lista.append(texto("li", mensagem));
      }
      if (lista.childElementCount) area.append(texto("h3", "Avisos da licença"), lista);
    }
    function montarCancelamento(modo) {
      const titulo = modo === "trial" ? "Encerrar trial agora" : "Desativar renovação";
      const detalhes = document.createElement("details");
      detalhes.append(texto("summary", titulo));
      const form = document.createElement("form");
      const email = campo("E-mail da conta", "email", "username");
      const senha = campo("Senha atual", "password", "current-password");
      const ciencia = document.createElement("input");
      ciencia.type = "checkbox";
      ciencia.required = true;
      const confirma = texto("label", modo === "trial"
        ? " Entendo que o acesso terminará agora e os dados operacionais não terão prazo de recuperação."
        : " Entendo que o acesso fica disponível pelo período pago e não será renovado.");
      confirma.prepend(ciencia);
      const botao = texto("button", titulo);
      botao.type = "submit";
      const requisicao = crypto.randomUUID();
      let recibo;
      form.append(email.rotulo, senha.rotulo, confirma, botao);
      form.onsubmit = async (evento) => {
        evento.preventDefault();
        if (botao.disabled || recibo) return;
        botao.disabled = true;
        status.textContent = "Confirmando o encerramento…";
        try {
          await confirmarSenhaAtual(email.input.value.trim(), senha.input.value);
          if (versao !== atual) return;
          recibo = await executar("loja_licenca_cancelar", {
            p_empresa:empresa, p_modo:modo, p_revisao:resumo.revisao,
            p_requisicao:requisicao, p_ciencia:ciencia.checked
          });
          if (versao !== atual) return;
          const atualizado = await resumoLicenca(empresa);
          if (versao === atual) {
            atualizarResumo(atualizado);
            await abrir(empresa, atualizado);
          }
        } catch {
          if (versao === atual) status.textContent = "Não foi possível confirmar. Confira a senha e o estado da licença.";
        } finally {
          senha.input.value = "";
          if (!recibo && versao === atual) botao.disabled = false;
        }
      };
      detalhes.append(form);
      area.append(detalhes);
    }
    if (versao !== atual) return;
    if (resumo.historico.length) {
      const historico = document.createElement("ul");
      for (const item of resumo.historico) {
        historico.append(texto("li", valor(item.valor_centavos) + " · " + nomes[item.estado]));
      }
      area.append(texto("h3", "Cobranças"), historico);
    }
  }
  return {abrir, limpar};
}
export const resumoLicenca = empresa => executar("loja_licenca_resumo", {p_empresa:empresa});
