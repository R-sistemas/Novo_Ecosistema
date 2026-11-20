import { chamarSupabasePainel, uuid } from "./painel-sessao.mjs";

export function bearer(valor) {
  return typeof valor === "string" && /^Bearer \S+$/i.test(valor);
}

export async function resolverLojaPainel(chamar, empresa) {
  const r = await chamar("/rest/v1/rpc/painel_contexto_sessao", {
    method: "POST", body: JSON.stringify({p_empresa_id:empresa})
  });
  if (!r.ok) throw Object.assign(new Error("Sessão administrativa indisponível."), {status:r.status});
  const dados = await r.json();
  if (dados.escopo !== "loja" || dados.empresa_id !== empresa.toLowerCase() ||
      !uuid.test(dados.usuario_id) || !dados.capacidades?.includes("loja.sessao")) {
    throw Object.assign(new Error("Acesso negado."), {status:403});
  }
  return dados;
}

export async function cadastrarOperador(req,res, painel = false) {
  res.setHeader("Cache-Control","no-store");
  if (req.method !== "POST") return res.status(405).end();
  const sessao = req.headers.authorization;
  if (!bearer(sessao)) return res.status(401).json({erro:"sessao_invalida"});
  const { email, senha, caixa, perfil = "vendas" } = req.body ?? {};
  const empresa = painel ? req.query?.empresa_id : req.body?.empresa;
  if (typeof empresa !== "string" || !uuid.test(empresa) ||
      typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof senha !== "string" || senha.length < 12 || senha.length > 72 ||
      !["vendas","cozinha"].includes(perfil) || (painel && ((perfil === "vendas" && caixa === null) || "papel" in (req.body ?? {}))) ||
      (perfil === "cozinha" && caixa !== null) ||
      (caixa !== null && (typeof caixa !== "string" || !caixa.trim() || caixa.length > 60))) {
    return res.status(400).json({erro:"Confira o e-mail, a senha inicial e o nome do caixa."});
  }

  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: chave } = process.env;
  // O cadastro legado já tinha a chave de serviço como apikey; o bearer segue sendo o do gestor.
  const chamarUsuario = chamarSupabasePainel(sessao, chave);
  if (!chamarUsuario || !url || !chave) return res.status(503).json({erro:"Cadastro indisponível."});
  const chamarServico = (caminho, method, body) => fetch(new URL(caminho,url), {
    method, headers:{apikey:chave,Authorization:"Bearer "+chave,"Content-Type":"application/json"},
    body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(6000)
  });
  const rpc = (nome,body) => chamarServico("/rest/v1/rpc/"+nome,"POST",body);
  let requisicao;
  let operador;
  const concluir = async resultado => {
    const r = await rpc("painel_concluir_cadastro_operador", {
      p_requisicao:requisicao,p_operador:operador ?? null,p_caixa:caixa,p_resultado:resultado
    });
    return r.ok ? {resultado:await r.json()} : {status:r.status};
  };
  const registrado = async resultado => (await concluir(resultado)).resultado === resultado;

  try {
    const auth = await chamarUsuario("/auth/v1/user");
    if (!auth.ok) {
      if ([401,403].includes(auth.status)) return res.status(401).json({erro:"sessao_invalida"});
      throw new Error();
    }
    const usuario = (await auth.json()).id;
    const contexto = await resolverLojaPainel(chamarUsuario,empresa);
    if (!uuid.test(usuario) || contexto.usuario_id !== usuario) return res.status(403).json({erro:"acesso_negado"});
    const tentativa = await rpc("painel_iniciar_cadastro_operador", {
      p_gestor:usuario,p_empresa:contexto.empresa_id,p_email:email,p_perfil:perfil
    });
    if (tentativa.status === 403) return res.status(403).json({erro:"acesso_negado"});
    if (!tentativa.ok) throw new Error();
    requisicao = await tentativa.json();
    if (!uuid.test(requisicao)) throw new Error();

    const criada = await chamarServico("/auth/v1/admin/users","POST",{email,password:senha,email_confirm:true});
    if (!criada.ok) {
      if (criada.status < 500 && await registrado("auth_recusado")) {
        return res.status(409).json({erro:"Não foi possível criar a conta. Confira o e-mail e a senha inicial."});
      }
      throw new Error();
    }
    operador = (await criada.json()).id;
    if (!uuid.test(operador)) { operador = undefined; throw new Error(); }
    const vinculo = await concluir("vinculado");
    if (vinculo.resultado === "vinculado") return res.status(201).json({cadastrado:true});
    if ([400,401,403,409].includes(vinculo.status)) {
      const reversao = await chamarServico("/auth/v1/admin/users/"+operador,"DELETE");
      if (reversao.ok && await registrado("auth_revertido")) {
        return res.status(409).json({erro:"Cadastro revertido. Confira o vínculo e o nome do caixa."});
      }
    }
    throw new Error();
  } catch (erro) {
    if (!requisicao && [401,403].includes(erro.status)) {
      return res.status(erro.status).json({erro:erro.status === 401 ? "sessao_invalida" : "acesso_negado"});
    }
    if (requisicao) {
      try {
        const observado = await concluir("indeterminado");
        if (observado.resultado === "vinculado") return res.status(201).json({cadastrado:true});
      } catch { /* a tentativa persistida orienta a reconciliação */ }
    }
    return res.status(502).json({erro:"Não foi possível confirmar o cadastro. Confira a equipe antes de repetir.",
      ...(requisicao ? {requisicao} : {})});
  }
}
