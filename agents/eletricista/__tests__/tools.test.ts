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

describe('eletricista tools', () => {
  it('exports all 4 tool definitions', () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain('contar_pontos');
    expect(names).toContain('dimensionar_circuitos');
    expect(names).toContain('levantar_eletrodutos');
    expect(names).toContain('listar_materiais_eletricos');
    expect(toolDefinitions.length).toBe(4);
  });

  it('contar_pontos creates quantitativos per type', async () => {
    const result = await toolHandlers.contar_pontos({
      project_id: 'p1',
      pontos: [
        { tipo: 'iluminacao', ambiente: 'Sala', quantidade: 2, potencia_w: 100, comando: 'interruptor simples' },
        { tipo: 'TUG', ambiente: 'Sala', quantidade: 5, potencia_w: 600 },
        { tipo: 'TUE', ambiente: 'Cozinha', quantidade: 1, potencia_w: 4500, equipamento: 'forno eletrico' },
      ],
      origem_prancha: 'page-1',
      confidence: 0.90,
    });
    expect(result).toBeDefined();
    expect((result as any).total_pontos).toBe(8);
  });

  it('dimensionar_circuitos creates quantitativos', async () => {
    const result = await toolHandlers.dimensionar_circuitos({
      project_id: 'p1',
      circuitos: [
        { numero: 1, tipo: 'iluminacao', descricao: 'Iluminacao sala/quartos', disjuntor_a: 10, secao_mm2: 1.5, fases: 1 },
        { numero: 2, tipo: 'TUG', descricao: 'Tomadas sala', disjuntor_a: 20, secao_mm2: 2.5, fases: 1 },
      ],
      quadro: 'QD-1',
      origem_prancha: 'page-1',
      confidence: 0.88,
    });
    expect(result).toBeDefined();
    expect((result as any).total_circuitos).toBe(2);
  });

  it('levantar_eletrodutos creates quantitativos', async () => {
    const result = await toolHandlers.levantar_eletrodutos({
      project_id: 'p1',
      trechos: [
        { tipo: 'rigido PVC', diametro_mm: 25, comprimento_m: 45, descricao: 'Circuitos 1-3 sala' },
        { tipo: 'flexivel corrugado', diametro_mm: 20, comprimento_m: 30, descricao: 'Derivacoes quartos' },
      ],
      origem_prancha: 'page-1',
      confidence: 0.85,
    });
    expect(result).toBeDefined();
    expect((result as any).total_metros).toBeCloseTo(75, 0);
  });

  it('listar_materiais_eletricos creates quantitativos', async () => {
    const result = await toolHandlers.listar_materiais_eletricos({
      project_id: 'p1',
      materiais: [
        { descricao: 'Disjuntor monopolar 20A curva C', unidade: 'un', quantidade: 6, categoria: 'protecao' },
        { descricao: 'DR 40A 30mA bipolar', unidade: 'un', quantidade: 2, categoria: 'protecao' },
        { descricao: 'QD embutir 24 modulos DIN', unidade: 'un', quantidade: 1, categoria: 'quadro' },
        { descricao: 'Luminaria LED painel 18W embutir', unidade: 'un', quantidade: 12, categoria: 'iluminacao' },
      ],
      origem_prancha: 'page-1',
      confidence: 0.92,
    });
    expect(result).toBeDefined();
    expect((result as any).total_itens).toBe(4);
  });
});
