export const slugValido = loja => typeof loja === "string" && loja.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(loja);
