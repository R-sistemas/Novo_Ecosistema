import { listar, executar } from "../../supabase-pdv.mjs";

export async function carregarDadosPdv({ empresa, administracao, usuario }) {
  const [catalogo, caixas, configuracao, terminais, pixDisponivel] = await Promise.all([
    listar(
      "produtos?ativo=eq.true&empresa_id=eq." +
        empresa +
        "&order=nome" +
        (administracao ? "" : "&select=id,codigo,nome,preco_centavos,categoria,vendido_por_peso"),
    ),
    administracao
      ? []
      : listar("caixas?empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=aberto_em.desc&limit=1"),
    listar(
      "empresas?select=nome,nome_pdv,pagamento_na_entrega" +
        (administracao ? ",cardapio_cor,cardapio_fundo,cardapio_logo,cardapio_agradecimento" : "") +
        "&id=eq." +
        empresa,
    ),
    administracao
      ? executar("listar_terminais_gestor", { p_empresa: empresa })
      : listar("terminais_pdv?select=id,nome&empresa_id=eq." + empresa + "&operador_id=eq." + usuario + "&order=nome"),
    administracao ? null : executar("pix_frente_disponivel", { p_empresa: empresa }),
  ]);
  const caixa = caixas[0];
  const registros =
    caixa && !administracao ? await listar("movimentos_caixa?caixa_id=eq." + caixa.id + "&order=criado_em.asc") : [];
  return {
    catalogo,
    caixas,
    configuracao,
    terminais,
    pixDisponivel,
    registros,
  };
}
