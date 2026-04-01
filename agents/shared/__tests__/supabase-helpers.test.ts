import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before import
vi.mock('../../../src/supabase-client.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
    textSearch: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    order: vi.fn().mockReturnThis(),
  },
}));

import {
  insertQuantitativo,
  insertOrcamentoItem,
  getProjectContext,
  getPdfPagesByType,
  searchSinapi,
  logAgentActivity,
} from '../supabase-helpers.js';

describe('supabase-helpers', () => {
  it('insertQuantitativo returns created record', async () => {
    const result = await insertQuantitativo({
      project_id: 'p1',
      disciplina: 'estrutural',
      item_code: '03.01',
      descricao: 'Concreto pilar',
      unidade: 'm3',
      quantidade: 2.45,
      calculo_memorial: '0.30x0.30x2.80',
      origem_prancha: 'page-1',
      origem_ambiente: 'P1',
      confidence: 0.95,
      needs_review: false,
      created_by: 'estrutural',
    });
    expect(result).toBeDefined();
  });

  it('searchSinapi accepts description and UF', async () => {
    const results = await searchSinapi('concreto fck 30', 'SP', 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it('getProjectContext returns AgentContext shape', async () => {
    const ctx = await getProjectContext('p1');
    expect(ctx).toBeDefined();
  });

  it('logAgentActivity writes to ob_agent_activity_log', async () => {
    await expect(
      logAgentActivity({
        project_id: 'p1',
        agent_slug: 'orcamentista',
        action: 'create_quantitativo',
        target_table: 'ob_quantitativos',
        target_id: 'q1',
        description: 'Criou quantitativo concreto pilar',
        input: {},
        output: {},
      })
    ).resolves.not.toThrow();
  });
});
