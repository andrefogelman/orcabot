import { searchSinapi, getSinapiByCodigo } from '../../../agents/shared/supabase-helpers.js';
import type { SinapiComposicao } from '../../../agents/shared/types.js';

/**
 * Search SINAPI by description keywords and UF.
 * Returns up to `limit` matching compositions/insumos.
 */
export async function lookupSinapi(params: {
  descricao: string;
  uf: string;
  limit?: number;
}): Promise<SinapiComposicao[]> {
  return await searchSinapi(params.descricao, params.uf, params.limit || 10);
}

/**
 * Look up a specific SINAPI item by code and UF.
 */
export async function lookupSinapiByCodigo(params: {
  codigo: string;
  uf: string;
}): Promise<SinapiComposicao | null> {
  return await getSinapiByCodigo(params.codigo, params.uf);
}

/**
 * Skill definition for NanoClaw container registration.
 */
export const skillDefinition = {
  name: 'sinapi-lookup',
  description: 'Busca composicoes e insumos SINAPI por descricao ou codigo. Base de precos da Caixa Economica Federal para orcamentacao de obras.',
  tools: [
    {
      name: 'sinapi_search',
      description: 'Busca SINAPI por descricao (full-text search). Retorna codigo, descricao, unidade, custos.',
      handler: lookupSinapi,
      input_schema: {
        type: 'object' as const,
        properties: {
          descricao: { type: 'string', description: 'Termos de busca (ex: concreto fck 30, alvenaria bloco 14x19x29)' },
          uf: { type: 'string', description: 'Estado: SP, RJ, MG, etc.' },
          limit: { type: 'number', description: 'Max resultados (default 10)' },
        },
        required: ['descricao', 'uf'],
      },
    },
    {
      name: 'sinapi_by_code',
      description: 'Busca SINAPI por codigo exato. Retorna composicao/insumo completo.',
      handler: lookupSinapiByCodigo,
      input_schema: {
        type: 'object' as const,
        properties: {
          codigo: { type: 'string', description: 'Codigo SINAPI (ex: 96995)' },
          uf: { type: 'string', description: 'Estado: SP, RJ, MG, etc.' },
        },
        required: ['codigo', 'uf'],
      },
    },
  ],
};
