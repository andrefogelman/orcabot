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

describe('hidraulico tools', () => {
  it('exports all 3 tool definitions', () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain('levantar_tubulacoes');
    expect(names).toContain('contar_conexoes');
    expect(names).toContain('listar_equipamentos');
    expect(toolDefinitions.length).toBe(3);
  });

  it('levantar_tubulacoes creates quantitativo per diameter', async () => {
    const result = await toolHandlers.levantar_tubulacoes({
      project_id: 'p1',
      sistema: 'agua_fria',
      trechos: [
        { diametro_mm: 25, material: 'PVC soldavel', comprimento_m: 15.5, descricao: 'Ramal banheiro' },
        { diametro_mm: 32, material: 'PVC soldavel', comprimento_m: 8.2, descricao: 'Barrilete' },
      ],
      origem_prancha: 'page-1',
      confidence: 0.88,
    });
    expect(result).toBeDefined();
    expect((result as any).total_metros).toBeCloseTo(23.7, 1);
  });

  it('contar_conexoes creates quantitativo', async () => {
    const result = await toolHandlers.contar_conexoes({
      project_id: 'p1',
      sistema: 'esgoto',
      conexoes: [
        { tipo: 'joelho 90', diametro_mm: 100, material: 'PVC serie normal', quantidade: 8 },
        { tipo: 'juncao simples', diametro_mm: 100, material: 'PVC serie normal', quantidade: 3 },
      ],
      origem_prancha: 'page-1',
      confidence: 0.85,
    });
    expect(result).toBeDefined();
    expect((result as any).total_pecas).toBe(11);
  });

  it('listar_equipamentos creates quantitativo', async () => {
    const result = await toolHandlers.listar_equipamentos({
      project_id: 'p1',
      equipamentos: [
        { tipo: 'vaso sanitario', modelo: 'caixa acoplada', quantidade: 3 },
        { tipo: 'lavatorio', modelo: 'coluna', quantidade: 2 },
        { tipo: 'caixa dagua', modelo: '1000L polietileno', quantidade: 1 },
      ],
      origem_prancha: 'page-1',
      confidence: 0.92,
    });
    expect(result).toBeDefined();
    expect((result as any).total_equipamentos).toBe(6);
  });
});
