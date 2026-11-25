import assert from "node:assert/strict";
import { test } from "node:test";

function elemento() {
  return {
    hidden: false, inert: false, open: false, value: "", textContent: "",
    options: [{}], filhos: [], eventos: {},
    addEventListener(evento, fn) { this.eventos[evento] = fn; },
    replaceChildren(...filhos) { this.filhos = filhos; },
    append(...filhos) { this.filhos.push(...filhos); },
    style: {}, setAttribute() {}, after() {},
    reset() {}, showModal() { this.open = true; }, close() { this.open = false; }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("troca A→B e A→B→A invalida botões, diálogo e respostas antigas", async t => {
  const elementos = new Map();
  const el = id => {
    if (!elementos.has(id)) elementos.set(id, elemento());
    return elementos.get(id);
  };
  t.mock.method(globalThis, "fetch", async (url, entrada) => {
    const dados = JSON.parse(entrada.body);
    if (url.endsWith("/ajustes_pendentes_caixa")) {
      return new Promise(resolve => consultas.push({ empresa: dados.p_empresa, resolve }));
    }
    if (url.endsWith("/fila_cozinha")) return Response.json([]);
    assert.ok(url.endsWith("/resolver_ajuste_comanda"));
    decisoes.push(dados);
    return Response.json(null);
  });
  globalThis.document = {
    getElementById: el, createElement: elemento, body: { dataset: {} },
    querySelector: () => ({ content: "fixture" })
  };
  t.after(() => { delete globalThis.document; });

  const consultas = [], decisoes = [];
  const { carregarAjustesCaixa } = await import("../ajustes-caixa.mjs");
  const { configurarSessao } = await import("../pdv/interface/sessao.mjs");
  const noop = () => {};
  configurarSessao({ el, operar: noop, estado: {}, area: () => "vendas" });
  const trocar = empresa => {
    el("empresa").value = empresa;
    el("empresa").eventos.change();
  };
  const resolver = (consulta, id) => consulta.resolve(Response.json([{ id, cliente: id }]));
  const lista = el("lista-ajustes-caixa");
  const dialogo = el("resolver-ajuste-caixa");
  const enviar = () => el("form-resolver-ajuste").onsubmit({ preventDefault: noop });

  trocar("A");
  resolver(consultas.shift(), "ajuste-A");
  await tick();
  const botaoA = lista.filhos[0].filhos[1];
  botaoA.onclick();
  assert.equal(dialogo.open, true);
  void carregarAjustesCaixa();
  const atrasadaA = consultas.shift();

  trocar("B");
  assert.equal(dialogo.open, false);
  assert.equal(el("ajustes-caixa").hidden, true);
  assert.deepEqual(lista.filhos, []);
  botaoA.onclick();
  await enviar();
  assert.equal(dialogo.open, false);
  assert.deepEqual(decisoes, []);
  const pendenteB = consultas.shift();
  assert.equal(pendenteB.empresa, "B");
  resolver(pendenteB, "ajuste-B");
  await tick();
  assert.match(lista.filhos[0].filhos[0].textContent, /ajuste-B/);

  void carregarAjustesCaixa();
  const atrasadaB = consultas.shift();
  trocar("A");
  botaoA.onclick();
  assert.equal(dialogo.open, false);
  resolver(atrasadaA, "atrasada-A");
  resolver(atrasadaB, "atrasada-B");
  await tick();
  assert.deepEqual(lista.filhos, []);

  resolver(consultas.shift(), "ajuste-A-novo");
  await tick();
  lista.filhos[0].filhos[1].onclick();
  await enviar();
  resolver(consultas.shift(), "ajuste-A-novo");
  await tick();
  assert.deepEqual(decisoes.map(({ p_empresa, p_id }) => [p_empresa, p_id]), [["A", "ajuste-A-novo"]]);
});
