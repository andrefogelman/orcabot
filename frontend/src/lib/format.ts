/**
 * Format number as Brazilian Real currency: R$ 1.234,56
 */
export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format number with Brazilian locale: 1.234,56
 */
export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format percentage: 12,00%
 */
export function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

/**
 * Parse a Brazilian formatted number string back to number.
 * "1.234,56" -> 1234.56
 */
export function parseBRNumber(str: string): number {
  const cleaned = str.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Format confidence as colored label text
 */
export function confidenceLabel(confidence: number): {
  text: string;
  color: "high" | "medium" | "low";
} {
  if (confidence >= 0.85) return { text: `${Math.round(confidence * 100)}% Alta`, color: "high" };
  if (confidence >= 0.7) return { text: `${Math.round(confidence * 100)}% Média`, color: "medium" };
  return { text: `${Math.round(confidence * 100)}% Baixa`, color: "low" };
}

/**
 * Format EAP code from number parts: [1, 2, 3] -> "01.02.003"
 */
export function formatEapCode(parts: number[]): string {
  return parts.map((p, i) => {
    if (i === 0) return String(p).padStart(2, "0");
    if (i === 1) return String(p).padStart(2, "0");
    return String(p).padStart(3, "0");
  }).join(".");
}
