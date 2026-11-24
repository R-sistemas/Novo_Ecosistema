export const recebedorSandboxMP = "3095871690";

export const contaDaOrdemMP = ordem => ordem?.collector_id ?? ordem?.user_id;

export function ordemNoAmbienteMP(ordem, sandbox, recebedor) {
  if (typeof ordem?.id !== "string" || !/^ORD[A-Z0-9]+$/i.test(ordem.id)) return false;
  if (typeof ordem.live_mode === "boolean" && ordem.live_mode === sandbox) return false;
  const conta = contaDaOrdemMP(ordem);
  if (recebedor && conta != null && String(conta) !== recebedor) return false;
  if (!sandbox && (String(conta) === recebedorSandboxMP || recebedor === recebedorSandboxMP)) return false;
  if (/^ORDTST/i.test(ordem.id) === sandbox) return true;
  return sandbox && recebedor === recebedorSandboxMP && String(conta) === recebedor;
}
