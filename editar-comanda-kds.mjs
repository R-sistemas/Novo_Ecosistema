import { executar } from "./supabase-pdv.mjs";
import { carregarCozinha } from "./cozinha.mjs";
import { configurarPesagem, detalhePesagem } from "./pesagem.mjs";

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
const pesagem = configurarPesagem(el("pesagem-kds"));
let comanda;
let catalogo = [];
let tentativa;

const chaveItem = item => item.pesagem?.id ?? item.produto_id;
const permitePesagem = () => comanda.mesa && !comanda.encaminhar;
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

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
  const lista = retirada ? comanda.itens.filter(item => !item.pesagem || permitePesagem())
    : catalogo.filter(item => !item.vendido_por_peso || permitePesagem());
  produto.replaceChildren(...lista.map(item => new Option(
    retirada ? `${item.nome} (${item.pesagem ? detalhePesagem(item.pesagem) + " · " + moeda.format(item.preco_centavos / 100) : item.quantidade + " na comanda"})`
      : `${item.codigo} · ${item.nome}${item.vendido_por_peso ? " · por peso" : ""}`,
    retirada ? chaveItem(item) : item.id
  )));
  produto.onchange();
  formulario.querySelector("button").disabled = !lista.length;
}

produto.onchange = () => {
  const retirada = acao.value === "retirar";
  const atual = retirada ? comanda.itens.find(item => chaveItem(item) === produto.value) : catalogo.find(item => item.id === produto.value);
  const pesado = atual?.pesagem || atual?.vendido_por_peso;
  el("quantidade-unidade-kds").hidden = Boolean(pesado);
  quantidade.disabled = Boolean(pesado);
  pesagem.abrir(!retirada && pesado ? atual.preco_quilo_centavos : null);
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
    const retirada = acao.value === "retirar";
    const item = retirada ? comanda.itens.find(i => chaveItem(i) === produto.value) : catalogo.find(i => i.id === produto.value);
    if (!item) throw new Error("Selecione um produto.");
    const dados = {
      p_empresa: loja(), p_pedido: comanda.id, p_operacao: acao.value, p_produto: produto.value,
      p_quantidade: quantidade.valueAsNumber, p_motivo: el("motivo-ajuste-kds").value.trim()
    };
    const pesado = item.vendido_por_peso || item.pesagem;
    const dadosPesagem = pesado ? {
      p_empresa: dados.p_empresa, p_pedido: dados.p_pedido, p_motivo: dados.p_motivo, p_caixa: null,
      p_produto: retirada ? null : item.id, p_retirar: retirada ? item.pesagem.id : null,
      ...(retirada ? { p_gramas: null, p_valor: null } : pesagem.dados())
    } : null;
    const chave = JSON.stringify(dadosPesagem ?? dados);
    if (tentativa?.chave !== chave) tentativa = { chave, id: crypto.randomUUID() };
    let estado = "aplicado";
    if (pesado) await executar("ajustar_item_pesado", { ...dadosPesagem, p_id: tentativa.id });
    else estado = await executar("registrar_ajuste_kds", { ...dados, p_id: tentativa.id });
    tentativa = undefined;
    formulario.reset();
    formulario.hidden = true;
    aviso.textContent = estado === "pendente" ? "Ajuste encaminhado. Aguarde a resolução." : "Ajuste registrado na comanda.";
    const cancelouComanda = retirada && estado === "aplicado" && comanda.itens.length === 1 &&
      (pesado || item.quantidade === dados.p_quantidade);
    if (!cancelouComanda) await buscar();
    void carregarCozinha();
  });
};
