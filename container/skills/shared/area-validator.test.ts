import { describe, it, expect } from 'vitest';
import { validateArea } from './area-validator.js';

describe('validateArea', () => {
  it('passes a normal room', () => {
    const result = validateArea(25.5, 20.4, 'Sala', 0.97);
    expect(result.valid).toBe(true);
    expect(result.flags).toHaveLength(0);
    expect(result.adjusted_confidence).toBe(0.97);
  });

  it('rejects zero area', () => {
    const result = validateArea(0, 10, 'Sala', 0.97);
    expect(result.valid).toBe(false);
    expect(result.flags).toContain('area_zero');
    expect(result.adjusted_confidence).toBe(0);
  });

  it('rejects negative area', () => {
    const result = validateArea(-5, 10, 'Sala', 0.97);
    expect(result.valid).toBe(false);
    expect(result.flags).toContain('area_zero');
  });

  it('flags very small area', () => {
    const result = validateArea(0.3, 2.2, 'Deposito', 0.97);
    expect(result.flags).toContain('area_muito_pequena');
    expect(result.adjusted_confidence).toBeLessThan(0.97);
  });

  it('flags very large area for single room', () => {
    const result = validateArea(600, 100, 'Sala', 0.97);
    expect(result.flags).toContain('area_muito_grande_ambiente_unico');
    expect(result.adjusted_confidence).toBeLessThan(0.97);
  });

  it('flags degenerate polygon (very low isoperimetric ratio)', () => {
    // Very long thin shape: area=10, perimeter=1000 → ratio ≈ 0.00013
    const result = validateArea(10, 1000, 'Circulacao', 0.97);
    expect(result.flags).toContain('poligono_degenerado');
    expect(result.adjusted_confidence).toBeLessThan(0.5);
  });

  it('flags inconsistent perimeter/area (ratio > 1.1)', () => {
    // Impossible: area=100, perimeter=5 → ratio ≈ 1005
    const result = validateArea(100, 5, 'Sala', 0.97);
    expect(result.flags).toContain('inconsistencia_perimetro_area');
  });

  it('flags banheiro with unrealistic area (50m²)', () => {
    const result = validateArea(50, 28, 'Banheiro Social', 0.97);
    expect(result.flags).toContain('area_fora_range_banheiro');
  });

  it('accepts normal banheiro (4m²)', () => {
    const result = validateArea(4, 8, 'Banheiro', 0.97);
    expect(result.valid).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('flags quarto with impossible area (2m²)', () => {
    const result = validateArea(2, 5.6, 'Quarto 01', 0.97);
    expect(result.flags).toContain('area_fora_range_quarto');
  });

  it('accepts normal quarto (12m²)', () => {
    const result = validateArea(12, 14, 'Quarto', 0.97);
    expect(result.valid).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('handles zero perimeter gracefully', () => {
    const result = validateArea(20, 0, 'Sala', 0.97);
    expect(result.valid).toBe(true); // No perimeter check when perimeter is 0
  });

  it('clamps confidence to [0, 1]', () => {
    const result = validateArea(0.1, 1, 'X', 0.97);
    expect(result.adjusted_confidence).toBeGreaterThanOrEqual(0);
    expect(result.adjusted_confidence).toBeLessThanOrEqual(1);
  });
});
