import {
  insertQuantitativo,
  logAgentActivity,
} from '../shared/supabase-helpers.js';
import type { Quantitativo } from '../shared/types.js';

const AGENT_SLUG = 'hidraulico';

const SISTEMA_PREFIX: Record<string, string> = {
  agua_fria: '05.01',
  agua_quente: '05.02',
  esgoto: '05.03',
  pluvial: '05.04',
  gas: '07.01',
  incendio: '07.02',
};

async function levantar_tubulacoes(params: {
  project_id: string;
  sistema: string;
  trechos: Array<{
    diametro_mm: number;
    material: string;
    comprimento_m: number;
    descricao: string;
  }>;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const prefix = SISTEMA_PREFIX[params.sistema] || '05.01';
  const criados: unknown[] = [];
  let total_metros = 0;

  // Group by diametro + material
  const agrupado = new Map<string, { diametro_mm: number; material: string; comprimento_total: number; descricoes: string[] }>();

  for (const trecho of params.trechos) {
    const key = `${trecho.diametro_mm}-${trecho.material}`;
    const existing = agrupado.get(key);
    if (existing) {
      existing.comprimento_total += trecho.comprimento_m;
      existing.descricoes.push(trecho.descricao);
    } else {
      agrupado.set(key, {
        diametro_mm: trecho.diametro_mm,
        material: trecho.material,
        comprimento_total: trecho.comprimento_m,
        descricoes: [trecho.descricao],
      });
    }
    total_metros += trecho.comprimento_m;
  }

  for (const [, grupo] of agrupado) {
    const comprimento = parseFloat(grupo.comprimento_total.toFixed(2));
    const calculo = `${params.sistema.toUpperCase()} DN${grupo.diametro_mm} ${grupo.material}: ${grupo.descricoes.join(' + ')} = ${comprimento} m`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'hidraulico',
      item_code: prefix,
      descricao: `Tubulacao ${grupo.material} DN${grupo.diametro_mm} - ${params.sistema.replace('_', ' ')}`,
      unidade: 'm',
      quantidade: comprimento,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: params.sistema,
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'levantar_tubulacoes',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_metros: parseFloat(total_metros.toFixed(2)), sistema: params.sistema };
}

async function contar_conexoes(params: {
  project_id: string;
  sistema: string;
  conexoes: Array<{
    tipo: string;
    diametro_mm: number;
    material: string;
    quantidade: number;
  }>;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const prefix = SISTEMA_PREFIX[params.sistema] || '05.01';
  const criados: unknown[] = [];
  let total_pecas = 0;

  for (const cx of params.conexoes) {
    const calculo = `${cx.tipo} DN${cx.diametro_mm} ${cx.material}: ${cx.quantidade} un (${params.sistema})`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'hidraulico',
      item_code: prefix,
      descricao: `${cx.tipo} ${cx.material} DN${cx.diametro_mm} - ${params.sistema.replace('_', ' ')}`,
      unidade: 'un',
      quantidade: cx.quantidade,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: params.sistema,
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);
    total_pecas += cx.quantidade;

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'contar_conexoes',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_pecas, sistema: params.sistema };
}

async function listar_equipamentos(params: {
  project_id: string;
  equipamentos: Array<{
    tipo: string;
    modelo: string;
    quantidade: number;
    especificacao?: string;
  }>;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const criados: unknown[] = [];
  let total_equipamentos = 0;

  for (const eq of params.equipamentos) {
    const calculo = `${eq.tipo} ${eq.modelo}: ${eq.quantidade} un${eq.especificacao ? ` (${eq.especificacao})` : ''}`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'hidraulico',
      item_code: '14.01',
      descricao: `${eq.tipo} - ${eq.modelo}`,
      unidade: 'un',
      quantidade: eq.quantidade,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: 'instalacoes',
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);
    total_equipamentos += eq.quantidade;

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'listar_equipamentos',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_equipamentos };
}

// ---- Tool Definitions ----

export const toolDefinitions = [
  {
    name: 'levantar_tubulacoes',
    description: 'Levanta metros lineares de tubulacoes por sistema (AF, AQ, ES, AP, gas, incendio), diametro e material. Agrupa trechos do mesmo diametro/material automaticamente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        sistema: { type: 'string', enum: ['agua_fria', 'agua_quente', 'esgoto', 'pluvial', 'gas', 'incendio'] },
        trechos: { type: 'array', items: { type: 'object', properties: { diametro_mm: { type: 'number' }, material: { type: 'string' }, comprimento_m: { type: 'number' }, descricao: { type: 'string' } }, required: ['diametro_mm', 'material', 'comprimento_m', 'descricao'] } },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'sistema', 'trechos', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'contar_conexoes',
    description: 'Conta conexoes hidraulicas por tipo (joelho, tee, reducao, juncao, etc.), diametro e material.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        sistema: { type: 'string', enum: ['agua_fria', 'agua_quente', 'esgoto', 'pluvial', 'gas', 'incendio'] },
        conexoes: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string' }, diametro_mm: { type: 'number' }, material: { type: 'string' }, quantidade: { type: 'number' } }, required: ['tipo', 'diametro_mm', 'material', 'quantidade'] } },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'sistema', 'conexoes', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'listar_equipamentos',
    description: 'Lista equipamentos e aparelhos hidrossanitarios: vasos, pias, tanques, chuveiros, caixas dagua, bombas, aquecedores, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        equipamentos: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string' }, modelo: { type: 'string' }, quantidade: { type: 'number' }, especificacao: { type: 'string' } }, required: ['tipo', 'modelo', 'quantidade'] } },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'equipamentos', 'origem_prancha', 'confidence'],
    },
  },
] as const;

export const toolHandlers: Record<string, (params: any) => Promise<unknown>> = {
  levantar_tubulacoes,
  contar_conexoes,
  listar_equipamentos,
};
