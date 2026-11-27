import { carregarCamposCartao, cartaoLicenca } from "../dados/licenca-cartao.mjs";

const moeda = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const reais = centavos => moeda.format(centavos / 100);
function criar(tag, texto) {
  const el = document.createElement(tag);
  el.textContent = texto;
  return el;
}
function dado(form, legenda, nome) {
  const label = criar("label",legenda);
  const input = document.createElement("input");
  input.name = nome;
  input.required = true;
  label.append(input);
  form.append(label);
  return input;
}

export function montarCartaoLicenca(destino, dados, atualizar) {
  const bloco = document.createElement("details");
  bloco.className = "cartao-licenca";
  bloco.append(criar("summary","Cartão de crédito — sandbox"));
  const status = criar("p","Use um cartão e um titular de teste do Mercado Pago.");
  status.setAttribute("role","status");
  bloco.append(status);
  destino.append(bloco);
  let iniciado = false;
  bloco.addEventListener("toggle", async () => {
    if (!bloco.open || iniciado) return;
    iniciado = true;
    try {
      const {publica} = await cartaoLicenca("config",{empresa:dados.empresa});
      const SDK = await carregarCamposCartao();
      if (!bloco.isConnected) return;
      montarCampos(bloco,status,new SDK(publica,{locale:"pt-BR"}),dados,atualizar);
    } catch {
      status.textContent = "Cartão de teste indisponível.";
      iniciado = false;
    }
  });
}

function montarCampos(bloco,status,mp,dados,atualizar) {
  const form = document.createElement("form");
  const prefixo = "licenca-cartao-" + crypto.randomUUID();
  const campos = [["cardNumber","Número do cartão"],["expirationDate","Validade"],["securityCode","Código de segurança"]]
    .map(([tipo,rotulo]) => {
      const el = document.createElement("div");
      el.id = prefixo + "-" + tipo;
      el.className = "campo-seguro-licenca";
      form.append(criar("span",rotulo),el);
      return [tipo,rotulo,el.id];
    });
  const titular = dado(form,"Nome do titular de teste","titular");
  const documento = dado(form,"CPF de teste","documento");
  documento.inputMode = "numeric";
  const label = criar("label","Condições do cartão");
  const parcelas = document.createElement("select");
  parcelas.required = true;
  label.append(parcelas);
  const termo = criar("label"," Aceito os termos " + dados.termos + " e as condições acima.");
  const aceite = document.createElement("input");
  aceite.type = "checkbox";
  aceite.required = true;
  termo.className = "aceite-cartao-licenca";
  termo.prepend(aceite);
  const pagar = criar("button","Pagar com cartão de teste");
  pagar.type = "submit";
  pagar.disabled = true;
  const valores = document.createElement("dl");
  valores.dataset.resumoCartao = "";
  form.append(label,valores,termo,pagar);
  bloco.append(form);

  let opcoes = [], bin, tentativa;
  let versao = 0;
  let enviando = false;
  const [numero] = campos.map(([tipo,rotulo,id]) => mp.fields.create(tipo,{srLabel:rotulo,ariaRequired:true}).mount(id));
  numero.on("binChange", async evento => {
    bin = evento.bin;
    const atual = ++versao;
    pagar.disabled = true;
    aceite.checked = false;
    opcoes = [];
    parcelas.replaceChildren(new Option("Escolha uma condição",""));
    valores.replaceChildren();
    if (!bin) return;
    try {
      const cotacao = await cartaoLicenca("cotar",{...dados,bin});
      if (atual !== versao || !bloco.isConnected) return;
      opcoes = cotacao.opcoes;
      opcoes.forEach((q,i) => parcelas.add(new Option(q.bandeira+" · "+q.vezes+"× de "+reais(q.parcela),String(i))));
      pagar.disabled = enviando || !opcoes.length;
    } catch {
      if (atual === versao) status.textContent = "Cotação indisponível para este cartão.";
    }
  });
  parcelas.onchange = () => {
    aceite.checked = false;
    valores.replaceChildren();
    const q = parcelas.value === "" ? null : opcoes[Number(parcelas.value)];
    if (q) for (const [rotulo,preco] of [["Valor da licença",q.base],["Acréscimo do parcelamento",q.total-q.base],["Total a pagar",q.total]]) {
      valores.append(criar("dt",rotulo),criar("dd",reais(preco)));
    }
  };
  form.onsubmit = async evento => {
    evento.preventDefault();
    const q = parcelas.value === "" ? null : opcoes[Number(parcelas.value)];
    if (enviando || !q || !aceite.checked) return;
    const atual = versao;
    const chave = JSON.stringify([bin,q]);
    if (tentativa?.chave !== chave) tentativa = {chave,id:crypto.randomUUID()};
    enviando = pagar.disabled = true;
    try {
      const token = await mp.fields.createCardToken({
        cardholderName:titular.value.trim(),identificationType:"CPF",identificationNumber:documento.value.replace(/\D/g,"")
      });
      if (atual !== versao || !bloco.isConnected || !token?.id) return;
      const resultado = await cartaoLicenca("pagar",{...dados,bin,token:token.id,requisicao:tentativa.id,condicoes:q});
      if (!bloco.isConnected) return;
      status.textContent = resultado.estado === "pendente" ? "Pagamento em processamento." : "Pagamento registrado.";
      await atualizar();
    } catch (e) {
      if (bloco.isConnected) status.textContent = e.status===409
        ? "As condições mudaram ou existe outra cobrança. Atualize o Financeiro."
        : "Não foi possível concluir. Confira os dados e tente novamente.";
    } finally {
      enviando = false;
      pagar.disabled = !opcoes.length;
    }
  };
}
