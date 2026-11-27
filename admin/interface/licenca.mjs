import { executar, executarApi } from "../../supabase-pdv.mjs";

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

export function prepararLicenca(area) {
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
    const status = texto("p", "");
    status.setAttribute("role", "status");
    const qr = document.createElement("textarea");
    qr.hidden = true;
    qr.readOnly = true;
    qr.setAttribute("aria-label", "Código Pix copia e cola");
    const botoes = [];
    async function pagar(dados, botao) {
      for (const controle of botoes) controle.disabled = true;
      status.textContent = "Consultando pagamento…";
      qr.hidden = true;
      qr.value = "";
      try {
        const resposta = await executarApi("mercado-pago-empresa?operacao_mp=licenca_pix", {empresa, ...dados});
        if (versao !== atual) return;
        if (resposta?.pix) {
          qr.value = resposta.pix;
          qr.hidden = false;
        }
        status.textContent = nomes[resposta?.estado] ?? "Pagamento indisponível.";
        if (resposta?.estado === "pendente") botao.textContent = "Consultar Pix";
        else {
          const atualizado = await resumoLicenca(empresa);
          if (versao === atual) await abrir(empresa, atualizado);
        }
      } catch {
        if (versao === atual) status.textContent = "Não foi possível consultar a cobrança. Tente novamente.";
      } finally {
        if (versao === atual) for (const controle of botoes) controle.disabled = false;
      }
    }

    const pendente = resumo.historico.find(item => ["pendente","revisao"].includes(item.estado));
    if (resumo.cobranca_ativa && pendente?.retomar) {
      const botao = texto("button", "Consultar Pix pendente");
      botao.type = "button";
      botao.onclick = () => pagar(pendente.retomar, botao);
      botoes.push(botao);
      area.append(botao);
    } else if (!pendente && resumo.fase !== "encerrada" && !resumo.nao_renovar) {
      for (const oferta of resumo.ofertas) {
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
      }
    }
    area.append(status, qr);
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
