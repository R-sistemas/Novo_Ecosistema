export function linkWhatsApp(telefone) {
  const digitos = telefone?.replace(/\D/g,"");
  if (!digitos) return null;
  const internacional = /^\+/.test(telefone.trim()) || /^55\d{10,11}$/.test(digitos);
  if (internacional && /^[1-9]\d{7,14}$/.test(digitos)) return "https://wa.me/" + digitos;
  return /^[1-9]\d{9,10}$/.test(digitos) ? "https://wa.me/55" + digitos : null;
}
