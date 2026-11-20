import { enviarAvisoPedido } from "../dados/avisos.mjs";
import { linkWhatsApp } from "../regras/contato.mjs";

function redigir(pedido,empresa,atualizar) {
  const dialogo = document.createElement("dialog");
  dialogo.setAttribute("aria-label","Avisar cliente");
  const formulario = document.createElement("form");
  const label = document.createElement("label");
  const mensagem = document.createElement("textarea");
  mensagem.required = true;
  mensagem.maxLength = 240;
  label.append("Mensagem para o cliente",mensagem);
  const retorno = document.createElement("p");
  retorno.setAttribute("role","status");
  const enviar = document.createElement("button");
  enviar.textContent = "Enviar aviso";
  const fechar = document.createElement("button");
  fechar.type = "button";
  fechar.textContent = "Fechar";
  fechar.onclick = () => dialogo.close();
  dialogo.addEventListener("close",() => dialogo.remove(),{once:true});
  formulario.onsubmit = async evento => {
    evento.preventDefault();
    if (enviar.disabled || !mensagem.value.trim()) return;
    enviar.disabled = fechar.disabled = true;
    try {
      await enviarAvisoPedido(empresa,pedido.id,mensagem.value.trim());
      dialogo.close();
      await atualizar();
    } catch {
      retorno.textContent = "Não foi possível confirmar o envio. Atualize a fila antes de tentar novamente.";
    } finally {
      enviar.disabled = fechar.disabled = false;
    }
  };
  formulario.append(label,retorno,enviar,fechar);
  dialogo.append(formulario);
  document.body.append(dialogo);
  dialogo.showModal();
}

export function contatoPedido(pedido,empresa,atualizar) {
  const conteudo = document.createDocumentFragment();
  if (pedido.pode_avisar) {
    const avisar = document.createElement("button");
    avisar.type = "button";
    avisar.textContent = "Avisar cliente";
    avisar.onclick = () => redigir(pedido,empresa,atualizar);
    conteudo.append(avisar);
  }
  const whatsapp = !pedido.mesa && linkWhatsApp(pedido.telefone_cliente);
  if (whatsapp) {
    const link = document.createElement("a");
    link.href = whatsapp;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "WhatsApp";
    conteudo.append(link);
  }
  if (pedido.avisos?.length) {
    const historico = document.createElement("details");
    const titulo = document.createElement("summary");
    titulo.textContent = "Avisos enviados (" + pedido.avisos.length + ")";
    const lista = document.createElement("ul");
    for (const aviso of pedido.avisos) {
      const linha = document.createElement("li");
      const hora = new Date(aviso.criado_em).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
      linha.textContent = hora + " · " + aviso.mensagem;
      lista.append(linha);
    }
    historico.append(titulo,lista);
    conteudo.append(historico);
  }
  return conteudo;
}
