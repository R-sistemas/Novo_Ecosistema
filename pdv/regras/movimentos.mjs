export const mapearMovimentos = (registros) =>
  registros.map((m) => ({
    tipo: m.tipo,
    meio: m.meio,
    valor: Number(m.valor_centavos),
    centavos: m.meio !== "dinheiro" ? 0 : Number(m.valor_centavos) * (m.tipo === "sangria" ? -1 : 1),
  }));
