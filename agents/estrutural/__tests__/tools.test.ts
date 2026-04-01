import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/supabase-client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

import { toolHandlers, toolDefinitions } from '../tools.js';

describe('estrutural tools', () => {
  it('exports all 4 tool definitions', () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain('estimar_concreto');
    expect(names).toContain('taxa_aco');
    expect(names).toContain('area_forma');
    expect(names).toContain('volume_escavacao');
    expect(toolDefinitions.length).toBe(4);
  });

  it('estimar_concreto calculates volume from dimensions', async () => {
    const result = await toolHandlers.estimar_concreto({
      project_id: 'p1',
      elemento: 'pilar',
      descricao: 'Pilar P1',
      dimensoes: { largura: 0.30, altura: 0.30, comprimento: 2.80 },
      fck: 30,
      quantidade_elementos: 10,
      origem_prancha: 'page-1',
      confidence: 0.95,
    });
    expect(result).toBeDefined();
    expect((result as any).volume_unitario).toBeCloseTo(0.252, 2);
    expect((result as any).volume_total).toBeCloseTo(2.52, 1);
  });

  it('taxa_aco estimates rebar mass from volume and rate', async () => {
    const result = await toolHandlers.taxa_aco({
      project_id: 'p1',
      elemento: 'pilar',
      volume_concreto_m3: 2.52,
      taxa_kg_m3: 120,
      tipo_aco: 'CA-50',
      origem_prancha: 'page-1',
      confidence: 0.85,
    });
    expect(result).toBeDefined();
    expect((result as any).massa_total_kg).toBeCloseTo(332.64, 0);
  });

  it('area_forma calculates formwork area', async () => {
    const result = await toolHandlers.area_forma({
      project_id: 'p1',
      elemento: 'pilar',
      dimensoes: { largura: 0.30, altura: 0.30, comprimento: 2.80 },
      quantidade_elementos: 10,
      reuso: 3,
      origem_prancha: 'page-1',
      confidence: 0.90,
    });
    expect(result).toBeDefined();
    expect((result as any).area_unitaria).toBeCloseTo(3.36, 2);
  });

  it('volume_escavacao calculates excavation', async () => {
    const result = await toolHandlers.volume_escavacao({
      project_id: 'p1',
      descricao: 'Escavacao sapata S1',
      comprimento: 1.50,
      largura: 1.50,
      profundidade: 1.20,
      folga_lateral: 0.30,
      quantidade: 10,
      volume_concreto_m3: 2.7,
      origem_prancha: 'page-1',
      confidence: 0.90,
    });
    expect(result).toBeDefined();
    expect((result as any).volume_escavacao_unitario).toBeCloseTo(5.292, 2);
  });
});
