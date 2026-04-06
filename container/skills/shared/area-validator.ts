// container/skills/shared/area-validator.ts
// Shared area validation for DXF and PDF pipelines.

export interface AreaValidation {
  valid: boolean;
  flags: string[];
  adjusted_confidence: number;
}

/**
 * Validate an extracted area against geometric and domain-specific rules.
 * Returns validation result with flags and adjusted confidence.
 */
export function validateArea(
  area_m2: number,
  perimetro_m: number,
  nome: string,
  base_confidence: number,
): AreaValidation {
  const flags: string[] = [];
  let confidence = base_confidence;

  // 1. Area zero or negative
  if (area_m2 <= 0) {
    return { valid: false, flags: ['area_zero'], adjusted_confidence: 0 };
  }

  // 2. Area outside realistic range for individual rooms
  if (area_m2 < 1.0) {
    flags.push('area_muito_pequena');
    confidence *= 0.5;
  }
  if (area_m2 > 500) {
    flags.push('area_muito_grande_ambiente_unico');
    confidence *= 0.3;
  }

  // 3. Isoperimetric ratio: 4π × area / perimeter²
  // Circle = 1.0, square ≈ 0.785, rectangle 2:1 ≈ 0.698
  // Below 0.05 = degenerate polygon, above 1.1 = impossible
  if (perimetro_m > 0) {
    const ratio = (4 * Math.PI * area_m2) / (perimetro_m * perimetro_m);
    if (ratio < 0.05) {
      flags.push('poligono_degenerado');
      confidence *= 0.2;
    } else if (ratio > 1.1) {
      flags.push('inconsistencia_perimetro_area');
      confidence *= 0.3;
    }
  }

  // 4. Room-type specific ranges (Brazilian residential/commercial)
  const ranges: Record<string, [number, number]> = {
    'banheiro': [1.5, 15],
    'wc': [1.0, 6],
    'lavabo': [1.0, 6],
    'cozinha': [4, 40],
    'sala': [8, 100],
    'quarto': [6, 40],
    'suite': [8, 50],
    'varanda': [2, 40],
    'garagem': [10, 80],
    'area de servico': [2, 15],
    'circulacao': [1, 30],
    'hall': [2, 30],
    'deposito': [1, 20],
    'despensa': [1, 10],
  };

  const nomeLower = nome.toLowerCase();
  for (const [tipo, [min, max]] of Object.entries(ranges)) {
    if (nomeLower.includes(tipo)) {
      if (area_m2 < min * 0.5 || area_m2 > max * 2) {
        flags.push(`area_fora_range_${tipo}`);
        confidence *= 0.5;
      }
      break;
    }
  }

  return {
    valid: flags.length === 0 || confidence > 0.3,
    flags,
    adjusted_confidence: Math.max(0, Math.min(1, confidence)),
  };
}
