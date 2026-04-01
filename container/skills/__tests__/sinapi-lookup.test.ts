import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/supabase-client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { id: '1', codigo: '96995', descricao: 'CONCRETO FCK 30 MPA', unidade: 'M3', uf: 'SP', custo_com_desoneracao: 485.32 },
          { id: '2', codigo: '96996', descricao: 'CONCRETO FCK 25 MPA', unidade: 'M3', uf: 'SP', custo_com_desoneracao: 442.10 },
        ],
        error: null,
      }),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: '1', codigo: '96995', descricao: 'CONCRETO FCK 30 MPA', unidade: 'M3', uf: 'SP', custo_com_desoneracao: 485.32 },
        error: null,
      }),
    })),
  },
}));

import { lookupSinapi, lookupSinapiByCodigo } from '../sinapi-lookup/index.js';

describe('sinapi-lookup skill', () => {
  it('lookupSinapi returns matches by description', async () => {
    const results = await lookupSinapi({ descricao: 'concreto fck 30', uf: 'SP' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].codigo).toBe('96995');
  });

  it('lookupSinapiByCodigo returns single match', async () => {
    const result = await lookupSinapiByCodigo({ codigo: '96995', uf: 'SP' });
    expect(result).toBeDefined();
  });
});
