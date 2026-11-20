import { painelVisao } from "../lib/painel-visao.mjs";
import { painelPedidos } from "../lib/painel-pedidos.mjs";
import { painelPreferencias } from "../lib/painel-preferencias.mjs";
import { cadastrarOperador } from "../lib/cadastro-operador.mjs";
import { painelEquipe } from "../lib/painel-equipe.mjs";
import { painelCatalogo } from "../lib/painel-catalogo.mjs";
import { painelSessao } from "../lib/painel-sessao.mjs";
import { monitorGestor } from "../lib/monitor-gestor.mjs";
import { atualizarDespachoRemo, despacharRemo } from "../lib/despacho-remo.mjs";

export default async function handler(req, res) {
  if (req.query?.monitor === "1") return monitorGestor(req, res);
  if (req.query?.painel_sessao === "1") return painelSessao(req, res);
  if (req.query?.painel_catalogo === "1") return painelCatalogo(req, res);
  if (req.query?.painel_equipe === "1") return painelEquipe(req, res);
  if (req.query?.painel_visao === "1") return painelVisao(req, res);
  if (req.query?.painel_pedidos === "1") return painelPedidos(req, res);
  if (req.query?.painel_preferencias === "1") return painelPreferencias(req, res);
  if (req.query?.despacho_remo === "1") return despacharRemo(req, res);
  if (req.query?.status_remo === "1") return atualizarDespachoRemo(req, res);
  return cadastrarOperador(req, res);
}
