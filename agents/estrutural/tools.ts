import {
  insertQuantitativo,
  logAgentActivity,
} from '../shared/supabase-helpers.js';
import type { Quantitativo } from '../shared/types.js';

const AGENT_SLUG = 'estrutural';

// ---- Tool Handlers ----

async function estimar_concreto(params: {
  project_id: string;
  elemento: string;
  descricao: string;
  dimensoes: { largura: number; altura: number; comprimento: number };
  fck: number;
  quantidade_elementos: number;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const { largura, altura, comprimento } = params.dimensoes;
  const volume_unitario = parseFloat((largura * altura * comprimento).toFixed(4));
  const volume_total = parseFloat((volume_unitario * params.quantidade_elementos).toFixed(2));

  const calculo = `${params.descricao}: ${largura} x ${altura} x ${comprimento} = ${volume_unitario} m3 x ${params.quantidade_elementos} = ${volume_total} m3 (fck ${params.fck} MPa)`;

  const isFundacao = ['sapata', 'bloco', 'estaca', 'radier', 'baldrame', 'fundacao'].some(
    (f) => params.elemento.toLowerCase().includes(f)
  );
  const prefix = isFundacao ? '02' : '03';

  const q: Quantitativo = {
    project_id: params.project_id,
    disciplina: 'estrutural',
    item_code: `${prefix}.01`,
    descricao: `Concreto fck ${params.fck} MPa - ${params.descricao}`,
    unidade: 'm3',
    quantidade: volume_total,
    calculo_memorial: calculo,
    origem_prancha: params.origem_prancha,
    origem_ambiente: params.elemento,
    confidence: params.confidence,
    needs_review: params.confidence < 0.7,
    created_by: AGENT_SLUG,
  };

  const created = await insertQuantitativo(q);

  await logAgentActivity({
    project_id: params.project_id,
    agent_slug: AGENT_SLUG,
    action: 'estimar_concreto',
    target_table: 'ob_quantitativos',
    target_id: created.id,
    description: calculo,
    output: created as unknown as Record<string, unknown>,
  });

  return { ...created, volume_unitario, volume_total };
}

async function taxa_aco(params: {
  project_id: string;
  elemento: string;
  volume_concreto_m3: number;
  taxa_kg_m3: number;
  tipo_aco: 'CA-50' | 'CA-60';
  origem_prancha: string;
  confidence: number;
  incluir_perdas?: boolean;
}): Promise<unknown> {
  const perdas = params.incluir_perdas !== false ? 1.10 : 1.0; // 10% perdas default
  const massa_sem_perdas = params.volume_concreto_m3 * params.taxa_kg_m3;
  const massa_total_kg = parseFloat((massa_sem_perdas * perdas).toFixed(2));

  const calculo = `${params.elemento} ${params.tipo_aco}: ${params.volume_concreto_m3} m3 x ${params.taxa_kg_m3} kg/m3 = ${massa_sem_perdas.toFixed(2)} kg + ${((perdas - 1) * 100).toFixed(0)}% perdas = ${massa_total_kg} kg`;

  const isFundacao = ['sapata', 'bloco', 'estaca', 'radier', 'baldrame', 'fundacao'].some(
    (f) => params.elemento.toLowerCase().includes(f)
  );
  const prefix = isFundacao ? '02' : '03';

  const q: Quantitativo = {
    project_id: params.project_id,
    disciplina: 'estrutural',
    item_code: `${prefix}.02`,
    descricao: `Aco ${params.tipo_aco} - ${params.elemento} (taxa ${params.taxa_kg_m3} kg/m3)`,
    unidade: 'kg',
    quantidade: massa_total_kg,
    calculo_memorial: calculo,
    origem_prancha: params.origem_prancha,
    origem_ambiente: params.elemento,
    confidence: params.confidence,
    needs_review: params.confidence < 0.7,
    created_by: AGENT_SLUG,
  };

  const created = await insertQuantitativo(q);

  await logAgentActivity({
    project_id: params.project_id,
    agent_slug: AGENT_SLUG,
    action: 'taxa_aco',
    target_table: 'ob_quantitativos',
    target_id: created.id,
    description: calculo,
    output: created as unknown as Record<string, unknown>,
  });

  return { ...created, massa_sem_perdas, massa_total_kg, perdas_percentual: (perdas - 1) * 100 };
}

async function area_forma(params: {
  project_id: string;
  elemento: string;
  dimensoes: { largura: number; altura: number; comprimento: number };
  quantidade_elementos: number;
  reuso: number;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const { largura, altura, comprimento } = params.dimensoes;
  let area_unitaria: number;
  let calculo_detalhe: string;

  const elem = params.elemento.toLowerCase();
  if (elem.includes('pilar')) {
    const perimetro = 2 * (largura + altura);
    area_unitaria = parseFloat((perimetro * comprimento).toFixed(4));
    calculo_detalhe = `Perimetro (${largura}+${altura})x2 = ${perimetro.toFixed(2)} x h ${comprimento} = ${area_unitaria} m2`;
  } else if (elem.includes('viga')) {
    const fundo = largura * comprimento;
    const laterais = 2 * altura * comprimento;
    area_unitaria = parseFloat((fundo + laterais).toFixed(4));
    calculo_detalhe = `Fundo ${largura}x${comprimento} + 2 laterais ${altura}x${comprimento} = ${area_unitaria} m2`;
  } else if (elem.includes('laje')) {
    area_unitaria = parseFloat((largura * comprimento).toFixed(4));
    calculo_detalhe = `Fundo ${largura}x${comprimento} = ${area_unitaria} m2`;
  } else if (elem.includes('sapata') || elem.includes('fundacao') || elem.includes('bloco')) {
    const perimetro = 2 * (largura + comprimento);
    area_unitaria = parseFloat((perimetro * altura).toFixed(4));
    calculo_detalhe = `Laterais: perimetro (${largura}+${comprimento})x2 = ${perimetro.toFixed(2)} x h ${altura} = ${area_unitaria} m2`;
  } else {
    const perimetro = 2 * (largura + altura);
    area_unitaria = parseFloat((perimetro * comprimento).toFixed(4));
    calculo_detalhe = `Perimetro x comprimento = ${area_unitaria} m2`;
  }

  const area_total = parseFloat((area_unitaria * params.quantidade_elementos).toFixed(2));
  const calculo = `Forma ${params.elemento}: ${calculo_detalhe} x ${params.quantidade_elementos} un = ${area_total} m2 (reuso ${params.reuso}x)`;

  const isFundacao = ['sapata', 'bloco', 'estaca', 'radier', 'baldrame', 'fundacao'].some(
    (f) => elem.includes(f)
  );
  const prefix = isFundacao ? '02' : '03';

  const q: Quantitativo = {
    project_id: params.project_id,
    disciplina: 'estrutural',
    item_code: `${prefix}.03`,
    descricao: `Forma ${params.elemento} (reuso ${params.reuso}x)`,
    unidade: 'm2',
    quantidade: area_total,
    calculo_memorial: calculo,
    origem_prancha: params.origem_prancha,
    origem_ambiente: params.elemento,
    confidence: params.confidence,
    needs_review: params.confidence < 0.7,
    created_by: AGENT_SLUG,
  };

  const created = await insertQuantitativo(q);

  await logAgentActivity({
    project_id: params.project_id,
    agent_slug: AGENT_SLUG,
    action: 'area_forma',
    target_table: 'ob_quantitativos',
    target_id: created.id,
    description: calculo,
    output: created as unknown as Record<string, unknown>,
  });

  return { ...created, area_unitaria, area_total };
}

async function volume_escavacao(params: {
  project_id: string;
  descricao: string;
  comprimento: number;
  largura: number;
  profundidade: number;
  folga_lateral: number;
  quantidade: number;
  volume_concreto_m3: number;
  origem_prancha: string;
  confidence: number;
}): Promise<unknown> {
  const comp_total = params.comprimento + 2 * params.folga_lateral;
  const larg_total = params.largura + 2 * params.folga_lateral;
  const volume_escavacao_unitario = parseFloat((comp_total * larg_total * params.profundidade).toFixed(4));
  const volume_escavacao_total = parseFloat((volume_escavacao_unitario * params.quantidade).toFixed(2));
  const volume_reaterro = parseFloat((volume_escavacao_total - params.volume_concreto_m3).toFixed(2));
  const volume_bota_fora = parseFloat((params.volume_concreto_m3 * 1.30).toFixed(2)); // 30% empolamento

  const calculo = `${params.descricao}: (${params.comprimento}+${2 * params.folga_lateral}) x (${params.largura}+${2 * params.folga_lateral}) x ${params.profundidade} = ${volume_escavacao_unitario} m3 x ${params.quantidade} = ${volume_escavacao_total} m3. Reaterro: ${volume_reaterro} m3. Bota-fora: ${volume_bota_fora} m3`;

  const qEsc: Quantitativo = {
    project_id: params.project_id,
    disciplina: 'estrutural',
    item_code: '02.04',
    descricao: `Escavacao mecanica - ${params.descricao}`,
    unidade: 'm3',
    quantidade: volume_escavacao_total,
    calculo_memorial: calculo,
    origem_prancha: params.origem_prancha,
    origem_ambiente: params.descricao,
    confidence: params.confidence,
    needs_review: params.confidence < 0.7,
    created_by: AGENT_SLUG,
  };

  const created = await insertQuantitativo(qEsc);

  await logAgentActivity({
    project_id: params.project_id,
    agent_slug: AGENT_SLUG,
    action: 'volume_escavacao',
    target_table: 'ob_quantitativos',
    target_id: created.id,
    description: calculo,
    output: { volume_escavacao_total, volume_reaterro, volume_bota_fora },
  });

  return {
    ...created,
    volume_escavacao_unitario,
    volume_escavacao_total,
    volume_reaterro,
    volume_bota_fora,
  };
}

// ---- Tool Definitions ----

export const toolDefinitions = [
  {
    name: 'estimar_concreto',
    description: 'Calcula volume de concreto para um tipo de elemento estrutural a partir de dimensoes. Grava quantitativo no banco.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        elemento: { type: 'string', description: 'Tipo: pilar, viga, laje, sapata, bloco, baldrame, escada, reservatorio' },
        descricao: { type: 'string', description: 'Descricao especifica (ex: Pilar P1 terreo)' },
        dimensoes: { type: 'object', properties: { largura: { type: 'number' }, altura: { type: 'number' }, comprimento: { type: 'number' } }, required: ['largura', 'altura', 'comprimento'] },
        fck: { type: 'number', description: 'Resistencia do concreto em MPa (ex: 25, 30, 35)' },
        quantidade_elementos: { type: 'number', description: 'Numero de elementos iguais' },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'elemento', 'descricao', 'dimensoes', 'fck', 'quantidade_elementos', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'taxa_aco',
    description: 'Estima massa de aco (kg) por taxa media (kg/m3) aplicada ao volume de concreto. Inclui perdas de corte (10% default). Grava quantitativo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        elemento: { type: 'string' },
        volume_concreto_m3: { type: 'number' },
        taxa_kg_m3: { type: 'number', description: 'Taxa de aco em kg/m3 (pilar: 100-140, viga: 90-130, laje: 70-100)' },
        tipo_aco: { type: 'string', enum: ['CA-50', 'CA-60'] },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
        incluir_perdas: { type: 'boolean', description: 'Incluir 10% de perdas de corte/dobra (default true)' },
      },
      required: ['project_id', 'elemento', 'volume_concreto_m3', 'taxa_kg_m3', 'tipo_aco', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'area_forma',
    description: 'Calcula area de forma (m2) por tipo de elemento estrutural. Considera geometria especifica (pilar=perimetro x h, viga=fundo+laterais, laje=area). Grava quantitativo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        elemento: { type: 'string', description: 'Tipo: pilar, viga, laje, sapata, bloco' },
        dimensoes: { type: 'object', properties: { largura: { type: 'number' }, altura: { type: 'number' }, comprimento: { type: 'number' } }, required: ['largura', 'altura', 'comprimento'] },
        quantidade_elementos: { type: 'number' },
        reuso: { type: 'number', description: 'Numero de reusos da forma (madeira: 3, metalica: 30)' },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'elemento', 'dimensoes', 'quantidade_elementos', 'reuso', 'origem_prancha', 'confidence'],
    },
  },
  {
    name: 'volume_escavacao',
    description: 'Calcula volumes de escavacao, reaterro e bota-fora para fundacoes. Considera folga lateral e empolamento (30%). Grava quantitativo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        descricao: { type: 'string' },
        comprimento: { type: 'number' },
        largura: { type: 'number' },
        profundidade: { type: 'number' },
        folga_lateral: { type: 'number', description: 'Folga lateral em metros (tipico 0.30)' },
        quantidade: { type: 'number' },
        volume_concreto_m3: { type: 'number', description: 'Volume total de concreto (para calculo do reaterro)' },
        origem_prancha: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['project_id', 'descricao', 'comprimento', 'largura', 'profundidade', 'folga_lateral', 'quantidade', 'volume_concreto_m3', 'origem_prancha', 'confidence'],
    },
  },
] as const;

export const toolHandlers: Record<string, (params: any) => Promise<unknown>> = {
  estimar_concreto,
  taxa_aco,
  area_forma,
  volume_escavacao,
};
