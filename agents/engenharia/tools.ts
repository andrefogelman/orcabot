import { supabase } from '../../src/supabase-client.js';
import { logActivity } from '../../src/anf/activity-log.js';

const AGENT_SLUG = 'engenharia';

async function getAgentId(): Promise<string> {
  const { data } = await supabase
    .from('nano_agents')
    .select('id')
    .eq('slug', AGENT_SLUG)
    .single();
  return data!.id;
}

// 1. query_obras
export async function query_obras(params: { id?: number; status?: string; limit?: number }): Promise<unknown> {
  let query = supabase.from('obracada').select('*').limit(params.limit || 20);
  if (params.id) query = query.eq('id', params.id);
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(`query_obras: ${error.message}`);
  return data;
}

// 2. query_contratos
export async function query_contratos(params: { obra_id?: number; limit?: number }): Promise<unknown> {
  let query = supabase.from('contrato').select('*').limit(params.limit || 20);
  if (params.obra_id) query = query.eq('id_obracada', params.obra_id);
  const { data, error } = await query;
  if (error) throw new Error(`query_contratos: ${error.message}`);
  return data;
}

// 3. executar_medicao
export async function executar_medicao(params: { id_obracada: number; descricao: string; valor: number; periodo_inicio: string; periodo_fim: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const { data, error } = await supabase
    .from('medicao')
    .insert({ id_obracada: params.id_obracada, descricao: params.descricao, valor: params.valor, periodo_inicio: params.periodo_inicio, periodo_fim: params.periodo_fim, status: 'executada' })
    .select()
    .single();
  if (error) throw new Error(`executar_medicao: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'medicao', target_id: String(data.id), description: `Executou medição obra ${params.id_obracada}: R$${params.valor}`, output: data as Record<string, unknown> });
  return data;
}

// 4. aprovar_medicao
export async function aprovar_medicao(params: { id: number; aprovado: boolean; justificativa: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const novoStatus = params.aprovado ? 'aprovada' : 'rejeitada';
  const { data, error } = await supabase
    .from('medicao')
    .update({ status: novoStatus, observacao: params.justificativa })
    .eq('id', params.id)
    .select()
    .single();
  if (error) throw new Error(`aprovar_medicao: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'medicao', target_id: String(params.id), description: `Medição ${params.id} ${novoStatus}: ${params.justificativa}`, output: data as Record<string, unknown> });
  return data;
}

// 5. query_cronograma
export async function query_cronograma(params: { obra_id: number }): Promise<unknown> {
  const { data, error } = await supabase
    .from('cronograma')
    .select('*')
    .eq('id_obracada', params.obra_id)
    .order('data_inicio', { ascending: true });
  if (error) throw new Error(`query_cronograma: ${error.message}`);
  return data;
}

// 6. update_cronograma
export async function update_cronograma(params: { id: number; status?: string; percentual?: number; observacao?: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const updates: Record<string, unknown> = {};
  if (params.status) updates.status = params.status;
  if (params.percentual !== undefined) updates.percentual_concluido = params.percentual;
  if (params.observacao) updates.observacao = params.observacao;
  const { data, error } = await supabase
    .from('cronograma')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();
  if (error) throw new Error(`update_cronograma: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'cronograma', target_id: String(params.id), description: `Atualizou atividade ${params.id}`, input: updates });
  return data;
}

// 7. query_documentos_obra
export async function query_documentos_obra(params: { obra_id: number }): Promise<unknown> {
  const { data, error } = await supabase
    .from('documentos_obra')
    .select('*')
    .eq('id_obracada', params.obra_id);
  if (error) throw new Error(`query_documentos_obra: ${error.message}`);
  return data;
}

// 8. calcular_quantitativo
export async function calcular_quantitativo(params: { obra_id: number; descricao: string }): Promise<unknown> {
  const { data: orcamento } = await supabase
    .from('orcamento_item')
    .select('*')
    .eq('id_obracada', params.obra_id);
  return { obra_id: params.obra_id, itens_orcamento: orcamento, descricao: params.descricao };
}

// 9. alertar_prazo
export async function alertar_prazo(params: { dias?: number }): Promise<unknown> {
  const dias = params.dias || 7;
  const dataLimite = new Date();
  dataLimite.setDate(dataLimite.getDate() + dias);
  const { data, error } = await supabase
    .from('cronograma')
    .select('*, obracada(descricao)')
    .lte('data_fim', dataLimite.toISOString().split('T')[0])
    .neq('status', 'concluida');
  if (error) throw new Error(`alertar_prazo: ${error.message}`);
  return { vencendo_em_dias: dias, atividades: data };
}

// 10. query_orcamentos
export async function query_orcamentos(params: { obra_id?: number }): Promise<unknown> {
  let query = supabase.from('orcamento').select('*');
  if (params.obra_id) query = query.eq('id_obracada', params.obra_id);
  const { data, error } = await query;
  if (error) throw new Error(`query_orcamentos: ${error.message}`);
  return data;
}

// 11. create_orcamento_item
export async function create_orcamento_item(params: { id_obracada: number; descricao: string; unidade: string; quantidade: number; valor_unitario: number }): Promise<unknown> {
  const agentId = await getAgentId();
  const { data, error } = await supabase
    .from('orcamento_item')
    .insert({ id_obracada: params.id_obracada, descricao: params.descricao, unidade: params.unidade, quantidade: params.quantidade, valor_unitario: params.valor_unitario })
    .select()
    .single();
  if (error) throw new Error(`create_orcamento_item: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'orcamento_item', target_id: String(data.id), description: `Criou item orçamento: ${params.descricao}`, output: data as Record<string, unknown> });
  return data;
}

// 12. update_orcamento
export async function update_orcamento(params: { id: number; valor_total?: number; status?: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const updates: Record<string, unknown> = {};
  if (params.valor_total) updates.valor_total = params.valor_total;
  if (params.status) updates.status = params.status;
  const { data, error } = await supabase
    .from('orcamento')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();
  if (error) throw new Error(`update_orcamento: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'orcamento', target_id: String(params.id), description: `Atualizou orçamento ${params.id}`, input: updates });
  return data;
}

// 13. comparar_orcado_realizado
export async function comparar_orcado_realizado(params: { obra_id: number }): Promise<unknown> {
  const { data: orcamento } = await supabase
    .from('orcamento_item')
    .select('descricao, quantidade, valor_unitario')
    .eq('id_obracada', params.obra_id);
  const { data: medicoes } = await supabase
    .from('medicao')
    .select('descricao, valor, status')
    .eq('id_obracada', params.obra_id);
  return { obra_id: params.obra_id, orcamento, medicoes };
}

// 14. avaliar_carimbo_nf
export async function avaliar_carimbo_nf(params: { nf_id: number }): Promise<unknown> {
  const agentId = await getAgentId();
  await logActivity({ agent_id: agentId, action: 'decision', target_table: 'nota_fiscal', target_id: String(params.nf_id), description: `Avaliando carimbo NF ${params.nf_id}` });
  return { nf_id: params.nf_id, status: 'avaliacao_pendente', message: 'Dados da NF carregados para avaliação de etapa/inclusão' };
}

// 15. aprovar_atribuicao_produto
export async function aprovar_atribuicao_produto(params: { nf_id: number; produto_id: number; etapa: string; aprovado: boolean; justificativa: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const acao = params.aprovado ? 'aprovada' : 'recusada';
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'nota_fiscal', target_id: String(params.nf_id), description: `Atribuição produto ${params.produto_id} à etapa "${params.etapa}" ${acao}: ${params.justificativa}`, input: params as unknown as Record<string, unknown> });
  return { nf_id: params.nf_id, produto_id: params.produto_id, etapa: params.etapa, resultado: acao, justificativa: params.justificativa };
}

// 16. query_produtos_rag
export async function query_produtos_rag(params: { search: string; limit?: number }): Promise<unknown> {
  const { data, error } = await supabase
    .from('produtos_rag')
    .select('*')
    .textSearch('descricao', params.search)
    .limit(params.limit || 10);
  if (error) throw new Error(`query_produtos_rag: ${error.message}`);
  return data;
}

// 17. alimentar_produtos_rag
export async function alimentar_produtos_rag(params: { descricao: string; categoria: string; subcategoria?: string; unidade: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const { data, error } = await supabase
    .from('produtos_rag')
    .insert({ descricao: params.descricao, categoria: params.categoria, subcategoria: params.subcategoria, unidade: params.unidade })
    .select()
    .single();
  if (error) throw new Error(`alimentar_produtos_rag: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'produtos_rag', target_id: String(data.id), description: `Inseriu produto RAG: ${params.descricao}`, output: data as Record<string, unknown> });
  return data;
}

// 18. classificar_produto
export async function classificar_produto(params: { produto_id: number; categoria: string; subcategoria: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const { data, error } = await supabase
    .from('produtos_rag')
    .update({ categoria: params.categoria, subcategoria: params.subcategoria })
    .eq('id', params.produto_id)
    .select()
    .single();
  if (error) throw new Error(`classificar_produto: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'produtos_rag', target_id: String(params.produto_id), description: `Classificou produto ${params.produto_id}: ${params.categoria}/${params.subcategoria}` });
  return data;
}

// Tool definitions
export const toolDefinitions = [
  { name: 'query_obras', description: 'Consulta dados das obras', input_schema: { type: 'object' as const, properties: { id: { type: 'number' }, status: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'query_contratos', description: 'Consulta contratos vinculados a obras', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' }, limit: { type: 'number' } } } },
  { name: 'executar_medicao', description: 'Executa e registra medição de obra', input_schema: { type: 'object' as const, properties: { id_obracada: { type: 'number' }, descricao: { type: 'string' }, valor: { type: 'number' }, periodo_inicio: { type: 'string' }, periodo_fim: { type: 'string' } }, required: ['id_obracada', 'descricao', 'valor', 'periodo_inicio', 'periodo_fim'] } },
  { name: 'aprovar_medicao', description: 'Aprova ou rejeita medição de obra', input_schema: { type: 'object' as const, properties: { id: { type: 'number' }, aprovado: { type: 'boolean' }, justificativa: { type: 'string' } }, required: ['id', 'aprovado', 'justificativa'] } },
  { name: 'query_cronograma', description: 'Consulta cronograma/atividades de obra', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' } }, required: ['obra_id'] } },
  { name: 'update_cronograma', description: 'Atualiza status de atividade no cronograma', input_schema: { type: 'object' as const, properties: { id: { type: 'number' }, status: { type: 'string' }, percentual: { type: 'number' }, observacao: { type: 'string' } }, required: ['id'] } },
  { name: 'query_documentos_obra', description: 'Consulta documentos técnicos da obra', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' } }, required: ['obra_id'] } },
  { name: 'calcular_quantitativo', description: 'Calcula quantitativos baseado em dados da obra', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' }, descricao: { type: 'string' } }, required: ['obra_id', 'descricao'] } },
  { name: 'alertar_prazo', description: 'Identifica atividades atrasadas ou vencendo', input_schema: { type: 'object' as const, properties: { dias: { type: 'number' } } } },
  { name: 'query_orcamentos', description: 'Consulta orçamentos por obra', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' } } } },
  { name: 'create_orcamento_item', description: 'Insere item de orçamento', input_schema: { type: 'object' as const, properties: { id_obracada: { type: 'number' }, descricao: { type: 'string' }, unidade: { type: 'string' }, quantidade: { type: 'number' }, valor_unitario: { type: 'number' } }, required: ['id_obracada', 'descricao', 'unidade', 'quantidade', 'valor_unitario'] } },
  { name: 'update_orcamento', description: 'Atualiza valores/status do orçamento', input_schema: { type: 'object' as const, properties: { id: { type: 'number' }, valor_total: { type: 'number' }, status: { type: 'string' } }, required: ['id'] } },
  { name: 'comparar_orcado_realizado', description: 'Compara orçamento vs executado por obra', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' } }, required: ['obra_id'] } },
  { name: 'avaliar_carimbo_nf', description: 'Valida etapa/inclusão proposta na extração de NF', input_schema: { type: 'object' as const, properties: { nf_id: { type: 'number' } }, required: ['nf_id'] } },
  { name: 'aprovar_atribuicao_produto', description: 'Aprova ou recusa atribuição de produtos a etapas/centros de custo', input_schema: { type: 'object' as const, properties: { nf_id: { type: 'number' }, produto_id: { type: 'number' }, etapa: { type: 'string' }, aprovado: { type: 'boolean' }, justificativa: { type: 'string' } }, required: ['nf_id', 'produto_id', 'etapa', 'aprovado', 'justificativa'] } },
  { name: 'query_produtos_rag', description: 'Busca produtos por similaridade', input_schema: { type: 'object' as const, properties: { search: { type: 'string' }, limit: { type: 'number' } }, required: ['search'] } },
  { name: 'alimentar_produtos_rag', description: 'Insere/atualiza produto no sistema RAG', input_schema: { type: 'object' as const, properties: { descricao: { type: 'string' }, categoria: { type: 'string' }, subcategoria: { type: 'string' }, unidade: { type: 'string' } }, required: ['descricao', 'categoria', 'unidade'] } },
  { name: 'classificar_produto', description: 'Classifica produto em categoria/subcategoria', input_schema: { type: 'object' as const, properties: { produto_id: { type: 'number' }, categoria: { type: 'string' }, subcategoria: { type: 'string' } }, required: ['produto_id', 'categoria', 'subcategoria'] } },
] as const;

export const toolHandlers: Record<string, (params: any) => Promise<unknown>> = {
  query_obras, query_contratos, executar_medicao, aprovar_medicao,
  query_cronograma, update_cronograma, query_documentos_obra, calcular_quantitativo,
  alertar_prazo, query_orcamentos, create_orcamento_item, update_orcamento,
  comparar_orcado_realizado, avaliar_carimbo_nf, aprovar_atribuicao_produto,
  query_produtos_rag, alimentar_produtos_rag, classificar_produto,
};
