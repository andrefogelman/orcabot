import { supabase } from '../../src/supabase-client.js';
import type {
  Quantitativo,
  OrcamentoItem,
  AgentContext,
  PdfPageData,
  SinapiComposicao,
} from './types.js';

// ---- Quantitativos ----

export async function insertQuantitativo(q: Quantitativo): Promise<Quantitativo> {
  const { data, error } = await supabase
    .from('ob_quantitativos')
    .insert(q)
    .select()
    .single();
  if (error) throw new Error(`insertQuantitativo: ${error.message}`);
  return data as Quantitativo;
}

export async function getQuantitativosByProject(
  projectId: string,
  disciplina?: string
): Promise<Quantitativo[]> {
  let query = supabase
    .from('ob_quantitativos')
    .select('*')
    .eq('project_id', projectId);
  if (disciplina) query = query.eq('disciplina', disciplina);
  const { data, error } = await query.order('item_code', { ascending: true });
  if (error) throw new Error(`getQuantitativosByProject: ${error.message}`);
  return (data || []) as Quantitativo[];
}

// ---- Orcamento Items ----

export async function insertOrcamentoItem(item: OrcamentoItem): Promise<OrcamentoItem> {
  const { data, error } = await supabase
    .from('ob_orcamento_items')
    .insert(item)
    .select()
    .single();
  if (error) throw new Error(`insertOrcamentoItem: ${error.message}`);
  return data as OrcamentoItem;
}

export async function getOrcamentoByProject(projectId: string): Promise<OrcamentoItem[]> {
  const { data, error } = await supabase
    .from('ob_orcamento_items')
    .select('*')
    .eq('project_id', projectId)
    .order('eap_code', { ascending: true });
  if (error) throw new Error(`getOrcamentoByProject: ${error.message}`);
  return (data || []) as OrcamentoItem[];
}

// ---- Project Context ----

export async function getProjectContext(projectId: string): Promise<AgentContext> {
  const { data, error } = await supabase
    .from('ob_projects')
    .select('id, tipo_obra, area_total_m2, uf, cidade, data_base_sinapi, bdi_percentual, premissas')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(`getProjectContext: ${error.message}`);
  return {
    project_id: data.id,
    tipo_obra: data.tipo_obra,
    area_total_m2: data.area_total_m2,
    uf: data.uf,
    cidade: data.cidade,
    data_base_sinapi: data.data_base_sinapi,
    bdi_percentual: data.bdi_percentual,
    premissas: data.premissas || {},
  } as AgentContext;
}

// ---- PDF Pages ----

export async function getPdfPagesByType(
  projectId: string,
  tipo: string
): Promise<PdfPageData[]> {
  const { data, error } = await supabase
    .from('ob_pdf_pages')
    .select('*, ob_project_files!inner(project_id)')
    .eq('ob_project_files.project_id', projectId)
    .ilike('tipo', `${tipo}%`)
    .order('page_number', { ascending: true });
  if (error) throw new Error(`getPdfPagesByType: ${error.message}`);
  return (data || []) as unknown as PdfPageData[];
}

export async function getPdfPagesByIds(ids: string[]): Promise<PdfPageData[]> {
  const { data, error } = await supabase
    .from('ob_pdf_pages')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`getPdfPagesByIds: ${error.message}`);
  return (data || []) as PdfPageData[];
}

// ---- SINAPI ----

export async function searchSinapi(
  descricao: string,
  uf: string,
  limit: number = 10
): Promise<SinapiComposicao[]> {
  // Use full-text search with tsquery
  const terms = descricao
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .join(' & ');
  const { data, error } = await supabase
    .from('ob_sinapi_composicoes')
    .select('*')
    .textSearch('descricao', terms)
    .eq('uf', uf)
    .limit(limit);
  if (error) throw new Error(`searchSinapi: ${error.message}`);
  return (data || []) as SinapiComposicao[];
}

export async function getSinapiByCodigo(
  codigo: string,
  uf: string
): Promise<SinapiComposicao | null> {
  const { data, error } = await supabase
    .from('ob_sinapi_composicoes')
    .select('*')
    .eq('codigo', codigo)
    .eq('uf', uf)
    .single();
  if (error) return null;
  return data as SinapiComposicao;
}

// ---- Activity Log ----

export async function logAgentActivity(entry: {
  project_id: string;
  agent_slug: string;
  action: string;
  target_table?: string;
  target_id?: string;
  description: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('ob_agent_activity_log').insert({
    project_id: entry.project_id,
    agent_slug: entry.agent_slug,
    action: entry.action,
    target_table: entry.target_table || null,
    target_id: entry.target_id || null,
    description: entry.description,
    input: entry.input || {},
    output: entry.output || {},
  });
  if (error) console.error(`[activity-log] Failed: ${error.message}`);
}

// ---- Flag for Review ----

export async function flagForReview(
  table: 'ob_quantitativos' | 'ob_pdf_pages',
  id: string,
  notes: string
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ needs_review: true, review_notes: notes })
    .eq('id', id);
  if (error) throw new Error(`flagForReview: ${error.message}`);
}
