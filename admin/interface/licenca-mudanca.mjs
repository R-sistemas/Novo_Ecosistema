import { executar } from "../../supabase-pdv.mjs";

function opcao(destino,texto) {
  const el = document.createElement("p");
  el.textContent = texto;
  destino.append(el);
}

export function mostrarMudancaLicenca(area,empresa,resumo,atualizar) {
  if (resumo.plano) opcao(area,"Plano vigente · " + resumo.plano);
  if (resumo.mudanca) {
    const data = resumo.mudanca.efetiva_em.split("-").reverse().join("/");
    opcao(area, resumo.mudanca.paga ? "Mudança paga, com início em " + data
      : "Mudança prevista para " + data + ", condicionada à confirmação do pagamento.");
    return;
  }
  if (!resumo.mudancas_ativas || resumo.situacao !== "valida" || resumo.nao_renovar) return;
  const ofertas = resumo.ofertas.filter(o=>o.id!==resumo.oferta_atual);
  if (!ofertas.length) return;
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Programar mudança para o próximo período";
  const select = document.createElement("select");
  select.required = true;
  select.add(new Option("Escolha uma oferta",""));
  for (const o of ofertas) select.add(new Option(o.plano + " · " + (o.meses===1?"mensal":"semestral"),o.id));
  label.append(select);
  const botao = document.createElement("button");
  botao.textContent = "Programar";
  const status = document.createElement("p");
  status.setAttribute("role","status");
  let tentativa;
  form.append(label,botao,status);
  form.onsubmit = async evento => {
    evento.preventDefault();
    const oferta = ofertas.find(o=>o.id===select.value);
    if (!oferta || botao.disabled) return;
    botao.disabled = true;
    if (tentativa?.oferta!==oferta.id) tentativa = {oferta:oferta.id,id:crypto.randomUUID()};
    try {
      await executar("loja_licenca_programar_mudanca",{p_empresa:empresa,p_oferta:oferta.id,
        p_termos:oferta.termos_versao,p_requisicao:tentativa.id});
      if (form.isConnected) await atualizar();
    } catch { status.textContent = "Não foi possível programar a mudança. Confira se há uma cobrança pendente."; }
    finally { botao.disabled = false; }
  };
  area.append(form);
}
