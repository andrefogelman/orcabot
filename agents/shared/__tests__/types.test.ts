import { describe, it, expect } from 'vitest';
import type {
  Quantitativo,
  OrcamentoItem,
  DelegationTask,
  DelegationResult,
  SinapiComposicao,
  PdfPageData,
  AgentContext,
} from '../types.js';

describe('shared types', () => {
  it('Quantitativo has required fields', () => {
    const q: Quantitativo = {
      project_id: 'uuid-1',
      disciplina: 'estrutural',
      item_code: '03.01',
      descricao: 'Concreto fck 30 MPa pilar P1',
      unidade: 'm3',
      quantidade: 2.45,
      calculo_memorial: '0.30 x 0.30 x 2.80 x 10 = 2.52 - 3% perdas = 2.45',
      origem_prancha: 'uuid-page-1',
      origem_ambiente: 'Pilar P1',
      confidence: 0.95,
      needs_review: false,
      created_by: 'estrutural',
    };
    expect(q.disciplina).toBe('estrutural');
    expect(q.quantidade).toBeGreaterThan(0);
  });

  it('OrcamentoItem has EAP hierarchy', () => {
    const item: OrcamentoItem = {
      project_id: 'uuid-1',
      eap_code: '03.01.001',
      eap_level: 3,
      descricao: 'Concreto fck 30 MPa para pilares',
      unidade: 'm3',
      quantidade: 2.45,
      fonte: 'sinapi',
      fonte_codigo: '96995',
      fonte_data_base: '2026-01',
      custo_unitario: 485.32,
      custo_material: 320.10,
      custo_mao_obra: 165.22,
      custo_total: 1189.03,
      adm_percentual: 25,
      peso_percentual: 0,
      curva_abc_classe: null,
      quantitativo_id: 'uuid-quant-1',
    };
    expect(item.eap_code).toMatch(/^\d{2}\.\d{2}\.\d{3}$/);
    expect(item.eap_level).toBe(3);
  });

  it('DelegationTask carries prancha data and context', () => {
    const task: DelegationTask = {
      id: 'task-uuid-1',
      project_id: 'uuid-1',
      from_agent: 'orcamentista',
      to_agent: 'estrutural',
      status: 'pending',
      pranchas: ['uuid-page-1', 'uuid-page-2'],
      context: { tipo_obra: 'residencial', area_total_m2: 120, uf: 'SP' },
      created_at: new Date().toISOString(),
    };
    expect(task.to_agent).toBe('estrutural');
    expect(task.pranchas.length).toBe(2);
  });

  it('DelegationResult carries quantitativos back', () => {
    const result: DelegationResult = {
      task_id: 'task-uuid-1',
      from_agent: 'estrutural',
      status: 'completed',
      quantitativos_created: ['uuid-q1', 'uuid-q2'],
      summary: 'Levantados 12 itens estruturais: 45.2 m3 concreto, 3800 kg aco, 312 m2 forma',
      warnings: ['Prancha EST-03 com cotas ilegiveis -- confidence < 70% em 2 itens'],
      completed_at: new Date().toISOString(),
    };
    expect(result.status).toBe('completed');
  });
});
