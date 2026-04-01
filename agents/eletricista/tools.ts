import {
  insertQuantitativo,
  logAgentActivity,
} from '../shared/supabase-helpers.js';
import type { Quantitativo } from '../shared/types.js';

const AGENT_SLUG = 'eletricista';

async function contar_pontos(params: {
  project_id: string;
  pontos: Array<{
    tipo: 'iluminacao' | 'TUG' | 'TUE';
    ambiente: string;
    quantidade: number;
    potencia_w: number;
    comando?: string;
    equipamento?: string;
  }>;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const criados: unknown[] = [];
  let total_pontos = 0;

  for (const ponto of params.pontos) {
    const detalhe = ponto.tipo === 'TUE'
      ? ` (${ponto.equipamento || 'uso especifico'}, ${ponto.potencia_w}W)`
      : ponto.tipo === 'iluminacao'
      ? ` (${ponto.potencia_w}W, ${ponto.comando || 'n/d'})`
      : ` (${ponto.potencia_w}W)`;

    const calculo = `Ponto ${ponto.tipo} ${ponto.ambiente}: ${ponto.quantidade} pt${detalhe}`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'eletrico',
      item_code: ponto.tipo === 'iluminacao' ? '06.01' : ponto.tipo === 'TUG' ? '06.02' : '06.03',
      descricao: `Ponto de ${ponto.tipo === 'iluminacao' ? 'iluminacao' : ponto.tipo === 'TUG' ? 'tomada uso geral' : 'tomada uso especifico'} - ${ponto.ambiente}${ponto.equipamento ? ` (${ponto.equipamento})` : ''}`,
      unidade: 'pt',
      quantidade: ponto.quantidade,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: ponto.ambiente,
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);
    total_pontos += ponto.quantidade;

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'contar_pontos',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_pontos };
}

async function dimensionar_circuitos(params: {
  project_id: string;
  circuitos: Array<{
    numero: number;
    tipo: string;
    descricao: string;
    disjuntor_a: number;
    secao_mm2: number;
    fases: number;
    dr?: boolean;
    dr_sensibilidade_ma?: number;
  }>;
  quadro: string;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const criados: unknown[] = [];
  let total_circuitos = 0;

  for (const circ of params.circuitos) {
    const calculo = `Circuito ${circ.numero} (${circ.tipo}): ${circ.descricao} - Disjuntor ${circ.disjuntor_a}A, cabo ${circ.secao_mm2}mm2, ${circ.fases}F${circ.dr ? `, DR ${circ.dr_sensibilidade_ma || 30}mA` : ''} - ${params.quadro}`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'eletrico',
      item_code: '06.04',
      descricao: `Circuito ${circ.numero} ${circ.tipo} - ${circ.descricao} (${params.quadro})`,
      unidade: 'un',
      quantidade: 1,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: params.quadro,
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);
    total_circuitos++;

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'dimensionar_circuitos',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_circuitos, quadro: params.quadro };
}

async function levantar_eletrodutos(params: {
  project_id: string;
  trechos: Array<{
    tipo: string;
    diametro_mm: number;
    comprimento_m: number;
    descricao: string;
  }>;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const criados: unknown[] = [];
  let total_metros = 0;

  // Group by tipo + diametro
  const agrupado = new Map<string, { tipo: string; diametro_mm: number; comprimento_total: number; descricoes: string[] }>();

  for (const trecho of params.trechos) {
    const key = `${trecho.tipo}-${trecho.diametro_mm}`;
    const existing = agrupado.get(key);
    if (existing) {
      existing.comprimento_total += trecho.comprimento_m;
      existing.descricoes.push(trecho.descricao);
    } else {
      agrupado.set(key, {
        tipo: trecho.tipo,
        diametro_mm: trecho.diametro_mm,
        comprimento_total: trecho.comprimento_m,
        descricoes: [trecho.descricao],
      });
    }
    total_metros += trecho.comprimento_m;
  }

  for (const [, grupo] of agrupado) {
    const comprimento = parseFloat(grupo.comprimento_total.toFixed(2));
    const calculo = `Eletroduto ${grupo.tipo} DN${grupo.diametro_mm}: ${grupo.descricoes.join(' + ')} = ${comprimento} m`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'eletrico',
      item_code: '06.05',
      descricao: `Eletroduto ${grupo.tipo} DN${grupo.diametro_mm}mm`,
      unidade: 'm',
      quantidade: comprimento,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: 'eletrodutos',
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'levantar_eletrodutos',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_metros: parseFloat(total_metros.toFixed(2)) };
}

async function listar_materiais_eletricos(params: {
  project_id: string;
  materiais: Array<{
    descricao: string;
    unidade: string;
    quantidade: number;
    categoria: string;
    especificacao?: string;
  }>;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const criados: unknown[] = [];
  let total_itens = 0;

  for (const mat of params.materiais) {
    const calculo = `${mat.descricao}: ${mat.quantidade} ${mat.unidade} (${mat.categoria})${mat.especificacao ? ` - ${mat.especificacao}` : ''}`;

    const q: Quantitativo = {
      project_id: params.project_id,
      disciplina: 'eletrico',
      item_code: '06.06',
      descricao: mat.descricao,
      unidade: mat.unidade,
      quantidade: mat.quantidade,
      calculo_memorial: calculo,
      origem_prancha: params.origem_prancha,
      origem_ambiente: mat.categoria,
      confidence: params.confidence,
      needs_review: params.confidence < 0.7,
      created_by: AGENT_SLUG,
    };

    const created = await insertQuantitativo(q);
    criados.push(created);
    total_itens++;

    await logAgentActivity({
      project_id: params.project_id,
      agent_slug: AGENT_SLUG,
      action: 'listar_materiais_eletricos',
      target_table: 'ob_quantitativos',
      target_id: created.id,
      description: calculo,
    });
  }

  return { criados, total_itens };
}

// ---- Tool Definitions ----

export const toolDefinitions = [
  {
    name: 'contar_pontos',
    description: 'Conta pontos eletricos por tipo (iluminacao, TUG, TUE) e ambiente. Cada ponto inclui tipo, potencia, comando e equipamento quando aplicavel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        pontos: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string', enum: ['iluminacao', 'TUG', 'TUE'] }, ambiente: { type: 'string' }, quantidade: { type: 'number' }, potencia_w: { type: 'number' }, comando: { type: 'string' }, equipamento: { type: 'string' } }, required: ['tipo', 'ambiente', 'quantidade', 'potencia_w'] } },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'pontos', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'dimensionar_circuitos',
    description: 'Registra circuitos dimensionados com disjuntor, secao de cabo e DR quando aplicavel. Um registro por circuito, associado ao quadro de distribuicao.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        circuitos: { type: 'array', items: { type: 'object', properties: { numero: { type: 'number' }, tipo: { type: 'string' }, descricao: { type: 'string' }, disjuntor_a: { type: 'number' }, secao_mm2: { type: 'number' }, fases: { type: 'number' }, dr: { type: 'boolean' }, dr_sensibilidade_ma: { type: 'number' } }, required: ['numero', 'tipo', 'descricao', 'disjuntor_a', 'secao_mm2', 'fases'] } },
        quadro: { type: 'string', description: 'Identificacao do quadro (QD-1, QD-2, QGD)' },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'circuitos', 'quadro', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'levantar_eletrodutos',
    description: 'Levanta metros lineares de eletrodutos por tipo (rigido PVC, flexivel corrugado, metalico) e diametro. Agrupa trechos do mesmo tipo/diametro.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        trechos: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string' }, diametro_mm: { type: 'number' }, comprimento_m: { type: 'number' }, descricao: { type: 'string' } }, required: ['tipo', 'diametro_mm', 'comprimento_m', 'descricao'] } },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'trechos', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'listar_materiais_eletricos',
    description: 'Lista materiais eletricos gerais: disjuntores, DRs, DPS, quadros, luminarias, hastes de aterramento, cabos, interruptores, tomadas, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        materiais: { type: 'array', items: { type: 'object', properties: { descricao: { type: 'string' }, unidade: { type: 'string' }, quantidade: { type: 'number' }, categoria: { type: 'string' }, especificacao: { type: 'string' } }, required: ['descricao', 'unidade', 'quantidade', 'categoria'] } },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'materiais', 'origem_prancha', 'confidence'],
    },
  },
] as const;

export const toolHandlers: Record<string, (params: any) => Promise<unknown>> = {
  contar_pontos,
  dimensionar_circuitos,
  levantar_eletrodutos,
  listar_materiais_eletricos,
};
