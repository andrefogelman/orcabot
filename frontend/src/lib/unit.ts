/**
 * Normaliza grafia de unidade para comparação.
 * Exemplos: "m²" → "m2", "M²" → "m2", "und" → "un", "kg " → "kg"
 */
export function normalizeUnit(u: string | null | undefined): string {
  if (!u) return "";
  return u
    .trim()
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/^und$/, "un")
    .replace(/^unid$/, "un");
}

/** Compara duas unidades depois de normalizar. */
export function unitsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return normalizeUnit(a) === normalizeUnit(b);
}
