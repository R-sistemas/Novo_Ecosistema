const etapasLoja = [
  ["novo", "Recebido"], ["preparo", "Em preparo"], ["pronto", "Pronto"]
];

export function exibirEtapasPedido(lista, pedido, { aguardandoPix, pixConfirmado }, entrega) {
  const etapaRemo = pedido.estado_remo;
  const paraEntrega = entrega || Boolean(etapaRemo);
  const fim = pedido.cancelado ? "Cancelado" : etapaRemo === "cancelada" ? "Entrega cancelada"
    : pedido.estado === "recusado" ? "Recusado" : null;
  const atual = fim ? "interrompido" : aguardandoPix ? "pix" : etapaRemo === "entregue" ? "entregue"
    : etapaRemo === "em_rota" ? "rota" : pedido.estado;
  const etapas = [
    ...(aguardandoPix || pixConfirmado ? [["pix", "Pagamento Pix"]] : []),
    ...etapasLoja,
    ...(paraEntrega ? [["rota", "A caminho"]] : []),
    ["entregue", paraEntrega ? "Entregue" : "Concluído"],
    ...(fim ? [["interrompido", fim]] : [])
  ];
  const indice = etapas.findIndex(([id]) => id === atual);
  const versao = JSON.stringify([etapas, indice]);
  if (lista.dataset.versao === versao) return;
  lista.dataset.versao = versao;
  lista.replaceChildren(...etapas.map(([, nome], i) => {
    const item = document.createElement("li");
    item.textContent = nome;
    if (i === indice) {
      item.setAttribute("aria-current", "step");
      if (fim) item.classList.add("etapa-interrompida");
    }
    if (!fim && i < indice) item.classList.add("etapa-concluida");
    return item;
  }));
  lista.hidden = false;
}
