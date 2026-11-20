import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";
import { bearer, cadastrarOperador, resolverLojaPainel } from "./cadastro-operador.mjs";

const acoes = new Set(["remover","terminal","nome_pdv","edicao_comanda","contato_cliente"]);
const falhas = {400:"dados_invalidos",401:"sessao_invalida",403:"acesso_negado",409:"conflito_equipe"};

export async function painelEquipe(req,res) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();
  const sessao = req.headers.authorization;
  if (!bearer(sessao)) return res.status(401).json({erro:"sessao_invalida"});
  const empresa = req.query?.empresa_id;
  if (typeof empresa !== "string" || !uuid.test(empresa)) return res.status(400).json({erro:"dados_invalidos"});
  const {acao,dados} = req.body ?? {};
  const leitura = req.method === "GET";
  if (!leitura && acao === "cadastrar") return cadastrarOperador(req,res,true);
  if (!leitura && (!acoes.has(acao) || !dados || typeof dados !== "object" || Array.isArray(dados))) {
    return res.status(400).json({erro:"dados_invalidos"});
  }

  const chamar = chamarSupabasePainel(sessao);
  if (!chamar) return res.status(503).json({erro:"equipe_indisponivel"});
  try {
    const contexto = await resolverLojaPainel(chamar,empresa);
    const resposta = await chamar("/rest/v1/rpc/painel_equipe", {
      method:"POST",body:JSON.stringify({p_empresa:contexto.empresa_id,p_acao:leitura ? "listar" : acao,p_dados:leitura ? {} : dados})
    });
    if (!resposta.ok) {
      if (falhas[resposta.status]) return res.status(resposta.status).json({erro:falhas[resposta.status]});
      throw new Error();
    }
    return res.status(200).json(await resposta.json());
  } catch (erro) {
    if (falhas[erro.status]) return res.status(erro.status).json({erro:falhas[erro.status]});
    return res.status(502).json({erro:"equipe_indisponivel"});
  }
}
