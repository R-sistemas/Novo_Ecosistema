import { executar } from "./supabase-pdv.mjs";
import { carregarCozinha } from "./cozinha.mjs";

const el = id => document.getElementById(id);
const loja = () => el("empresa").value;
const dialogo = el("editar-comanda-kds");
const busca = el("localizar-comanda-kds");
const formulario = el("salvar-ajuste-kds");
const numero = el("numero-comanda-kds");
const acao = el("acao-ajuste-kds");
const produto = el("produto-ajuste-kds");
const quantidade = el("quantidade-ajuste-kds");
const aviso = el("aviso-ajuste-kds");
let comanda;
let catalogo = [];
let tentativa;

export async function atualizarPermissaoKds() {
  const empresa = loja();
  const abrir = el("buscar-comanda-kds");
  abrir.hidden = true;
  try {
    const permitido = await executar("pode_editar_comanda_kds", { p_empresa: empresa });
    if (loja() === empresa) abrir.hidden = !permitido;
  } catch (erro) {
    el("aviso-cozinha").textContent = erro.message;
  }
}

function preencherProdutos() {
  const retirada = acao.value === "retirar";
  const lista = retirada ? comanda.itens : catalogo;
  produto.replaceChildren(...lista.map(item => new Option(
    retirada ? `${item.nome} (${item.quantidade} na comanda)` : `${item.codigo} · ${item.nome}`,
    retirada ? item.produto_id : item.id
  )));
  produto.onchange();
  formulario.querySelector("button").disabled = !lista.length;
}

produto.onchange = () => {
  const atual = acao.value === "retirar" ? comanda.itens.find(item => item.produto_id === produto.value) : null;
  quantidade.max = String(Math.min(atual?.quantidade ?? 100, 100));
  quantidade.value = "1";
};
acao.onchange = preencherProdutos;

async function buscar() {
  formulario.hidden = true;
  el("resumo-comanda-kds").textContent = "";
  el("historico-ajuste-kds").replaceChildren();
  const empresa = loja();
  const [pedido, produtos] = await Promise.all([
    executar("consultar_comanda_kds", { p_empresa: empresa, p_comanda: numero.value }),
    executar("catalogo_ajuste_kds", { p_empresa: empresa })
  ]);
  if (loja() !== empresa || !dialogo.open) return;
  comanda = pedido;
  catalogo = produtos;
  if (!pedido) throw new Error("Comanda indisponível para edição.");
  const local = pedido.mesa ? `Mesa ${pedido.mesa}` : "Pedido remoto";
  const status = pedido.pendente ? "Aguardando resolução" : pedido.encaminhar ? "O ajuste será enviado ao caixa" : "Pagamento no caixa";
  el("resumo-comanda-kds").textContent = `Comanda ${pedido.comanda} · ${local} · ${pedido.cliente} · ${status}`;
  const estados = { aplicado: "Aplicado", pendente: "Pendente", encerrado: "Encerrado" };
  el("historico-ajuste-kds").replaceChildren(...pedido.historico.map(ajuste => {
    const linha = document.createElement("li");
    linha.textContent = `${estados[ajuste.estado]} · ${ajuste.operacao} ${ajuste.quantidade} × ${ajuste.produto_nome} · ${ajuste.motivo}`;
    if (ajuste.resolucao) linha.textContent += ` · ${ajuste.resolucao}`;
    return linha;
  }));
  if (pedido.pendente) return;
  formulario.hidden = false;
  preencherProdutos();
}

async function operar(acao) {
  if (dialogo.inert) return;
  dialogo.inert = true;
  aviso.textContent = "";
  try {
    await acao();
  } catch (erro) {
    aviso.textContent = erro.message;
  } finally {
    dialogo.inert = false;
  }
}

function abrir(comanda) {
  busca.reset();
  formulario.reset();
  formulario.hidden = true;
  aviso.textContent = "";
  el("resumo-comanda-kds").textContent = "";
  el("historico-ajuste-kds").replaceChildren();
  dialogo.showModal();
  if (comanda) {
    numero.value = comanda;
    void operar(buscar);
  } else numero.focus();
}

el("buscar-comanda-kds").onclick = () => abrir();
el("fila-cozinha").addEventListener("ajustar-comanda", evento => abrir(evento.detail));
el("fechar-ajuste-kds").onclick = () => dialogo.close();
busca.onsubmit = evento => {
  evento.preventDefault();
  void operar(buscar);
};
formulario.onsubmit = evento => {
  evento.preventDefault();
  void operar(async () => {
    const dados = {
      p_empresa: loja(), p_pedido: comanda.id, p_operacao: acao.value, p_produto: produto.value,
      p_quantidade: quantidade.valueAsNumber, p_motivo: el("motivo-ajuste-kds").value.trim()
    };
    const chave = JSON.stringify(dados);
    if (tentativa?.chave !== chave) tentativa = { chave, id: crypto.randomUUID() };
    const estado = await executar("registrar_ajuste_kds", { ...dados, p_id: tentativa.id });
    tentativa = undefined;
    formulario.reset();
    formulario.hidden = true;
    aviso.textContent = estado === "pendente" ? "Ajuste encaminhado. Aguarde a resolução." : "Ajuste registrado na comanda.";
    if (estado === "pendente" || dados.p_operacao === "adicionar" || comanda.itens.some(item =>
      item.produto_id !== dados.p_produto || item.quantidade > dados.p_quantidade)) await buscar();
    void carregarCozinha();
  });
};
