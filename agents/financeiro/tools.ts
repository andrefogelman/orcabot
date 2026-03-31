import { supabase } from '../../src/supabase-client.js';
import { logActivity } from '../../src/anf/activity-log.js';

const AGENT_SLUG = 'financeiro';

async function getAgentId(): Promise<string> {
  const { data } = await supabase.from('nano_agents').select('id').eq('slug', AGENT_SLUG).single();
  return data!.id;
}

// 1. query_lancamentos
export async function query_lancamentos(params: { status?: string; tipo?: string; obra_id?: number; vencimento_ate?: string; limit?: number }): Promise<unknown> {
  let query = supabase.from('lanca').select('*').order('data_vencimento', { ascending: true }).limit(params.limit || 30);
  if (params.status) query = query.eq('status', params.status);
  if (params.tipo) query = query.eq('tipo', params.tipo);
  if (params.obra_id) query = query.eq('id_obracada', params.obra_id);
  if (params.vencimento_ate) query = query.lte('data_vencimento', params.vencimento_ate);
  const { data, error } = await query;
  if (error) throw new Error(`query_lancamentos: ${error.message}`);
  return data;
}

// 2. create_lancamento
export async function create_lancamento(params: { descricao: string; valor: number; tipo: string; id_obracada?: number; data_vencimento: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const { data, error } = await supabase.from('lanca').insert({ descricao: params.descricao, valor: params.valor, tipo: params.tipo, id_obracada: params.id_obracada, data_vencimento: params.data_vencimento, status: 'pendente' }).select().single();
  if (error) throw new Error(`create_lancamento: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'lanca', target_id: String(data.id), description: `Criou lançamento: ${params.descricao} R$${params.valor}`, output: data as Record<string, unknown> });
  return data;
}

// 3. update_lancamento
export async function update_lancamento(params: { id: number; status?: string; valor?: number; data_pagamento?: string }): Promise<unknown> {
  const agentId = await getAgentId();
  const updates: Record<string, unknown> = {};
  if (params.status) updates.status = params.status;
  if (params.valor) updates.valor = params.valor;
  if (params.data_pagamento) updates.data_pagamento = params.data_pagamento;
  const { data, error } = await supabase.from('lanca').update(updates).eq('id', params.id).select().single();
  if (error) throw new Error(`update_lancamento: ${error.message}`);
  await logActivity({ agent_id: agentId, action: 'write', target_table: 'lanca', target_id: String(params.id), description: `Atualizou lançamento ${params.id}`, input: updates, output: data as Record<string, unknown> });
  return data;
}

// 4. query_contas_bancarias
export async function query_contas_bancarias(params: { limit?: number }): Promise<unknown> {
  const { data, error } = await supabase.from('bank_accounts').select('*').limit(params.limit || 10);
  if (error) throw new Error(`query_contas_bancarias: ${error.message}`);
  return data;
}

// 5. projecao_fluxo_caixa
export async function projecao_fluxo_caixa(params: { meses?: number }): Promise<unknown> {
  const meses = params.meses || 3;
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() + meses);
  const { data, error } = await supabase.from('lanca').select('tipo, valor, data_vencimento, status').lte('data_vencimento', dataLimite.toISOString().split('T')[0]).in('status', ['pendente', 'aberto']);
  if (error) throw new Error(`projecao_fluxo_caixa: ${error.message}`);
  return { lancamentos: data, periodo_meses: meses };
}

// 6. alertar_vencimento
export async function alertar_vencimento(params: { dias?: number }): Promise<unknown> {
  const dias = params.dias || 7;
  const dataLimite = new Date();
  dataLimite.setDate(dataLimite.getDate() + dias);
  const { data, error } = await supabase.from('lanca').select('*').lte('data_vencimento', dataLimite.toISOString().split('T')[0]).in('status', ['pendente', 'aberto']).order('data_vencimento', { ascending: true });
  if (error) throw new Error(`alertar_vencimento: ${error.message}`);
  return { vencendo_em_dias: dias, lancamentos: data };
}

// 7. fechamento_mensal
export async function fechamento_mensal(params: { mes: number; ano: number }): Promise<unknown> {
  const inicio = `${params.ano}-${String(params.mes).padStart(2, '0')}-01`;
  const fim = new Date(params.ano, params.mes, 0).toISOString().split('T')[0];
  const { data, error } = await supabase.from('lanca').select('tipo, valor, status, data_vencimento, data_pagamento').gte('data_vencimento', inicio).lte('data_vencimento', fim);
  if (error) throw new Error(`fechamento_mensal: ${error.message}`);
  return { mes: params.mes, ano: params.ano, lancamentos: data };
}

// 8. preparar_docs_contabilidade
export async function preparar_docs_contabilidade(params: { mes: number; ano: number }): Promise<unknown> {
  const inicio = `${params.ano}-${String(params.mes).padStart(2, '0')}-01`;
  const fim = new Date(params.ano, params.mes, 0).toISOString().split('T')[0];
  const { data: lancamentos } = await supabase.from('lanca').select('*').gte('data_vencimento', inicio).lte('data_vencimento', fim);
  return { mes: params.mes, ano: params.ano, total_lancamentos: lancamentos?.length || 0, lancamentos };
}

// 9. avaliar_nf_centro_custo
export async function avaliar_nf_centro_custo(params: { obra_id: number; periodo_inicio?: string; periodo_fim?: string }): Promise<unknown> {
  let query = supabase.from('lanca').select('*').eq('id_obracada', params.obra_id);
  if (params.periodo_inicio) query = query.gte('data_vencimento', params.periodo_inicio);
  if (params.periodo_fim) query = query.lte('data_vencimento', params.periodo_fim);
  const { data, error } = await query;
  if (error) throw new Error(`avaliar_nf_centro_custo: ${error.message}`);
  return { obra_id: params.obra_id, lancamentos: data };
}

// 10. solicitar_guias_impostos
export async function solicitar_guias_impostos(params: { nf_ids: number[]; descricao: string }): Promise<unknown> {
  const agentId = await getAgentId();
  await logActivity({ agent_id: agentId, action: 'decision', description: `Solicitação de guias de impostos: ${params.descricao}`, input: { nf_ids: params.nf_ids } as Record<string, unknown> });
  return { status: 'solicitacao_registrada', nf_ids: params.nf_ids, descricao: params.descricao };
}

// 11. emitir_nf (stub — a ser implantado)
export async function emitir_nf(params: { descricao: string; valor: number; destinatario: string }): Promise<unknown> {
  return { status: 'nao_implementado', message: 'Emissão de NF será implantada em versão futura' };
}

// 12. query_rh_folha
export async function query_rh_folha(params: { mes?: number; ano?: number }): Promise<unknown> {
  let query = supabase.from('rh_folha_pagamento').select('*');
  if (params.mes) query = query.eq('mes', params.mes);
  if (params.ano) query = query.eq('ano', params.ano);
  const { data, error } = await query;
  if (error) throw new Error(`query_rh_folha: ${error.message}`);
  return data;
}

// 13. query_adiantamentos
export async function query_adiantamentos(params: { colaborador_id?: number; status?: string }): Promise<unknown> {
  let query = supabase.from('rh_adiantamento').select('*');
  if (params.colaborador_id) query = query.eq('colaborador_id', params.colaborador_id);
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(`query_adiantamentos: ${error.message}`);
  return data;
}

// 14. acompanhar_emprestimos
export async function acompanhar_emprestimos(params: { status?: string }): Promise<unknown> {
  let query = supabase.from('rh_emprestimo').select('*');
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(`acompanhar_emprestimos: ${error.message}`);
  return data;
}

// 15. gerar_relatorio_folha
export async function gerar_relatorio_folha(params: { mes: number; ano: number }): Promise<unknown> {
  const { data: folha } = await supabase.from('rh_folha_pagamento').select('*').eq('mes', params.mes).eq('ano', params.ano);
  const { data: adiantamentos } = await supabase.from('rh_adiantamento').select('*');
  const { data: emprestimos } = await supabase.from('rh_emprestimo').select('*');
  return { mes: params.mes, ano: params.ano, folha, adiantamentos_ativos: adiantamentos, emprestimos_ativos: emprestimos };
}

// 16. query_obracada
export async function query_obracada(params: { id?: number; status?: string }): Promise<unknown> {
  let query = supabase.from('obracada').select('id, descricao, status, valor_contrato');
  if (params.id) query = query.eq('id', params.id);
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(`query_obracada: ${error.message}`);
  return data;
}

// 17. query_medicoes
export async function query_medicoes(params: { obra_id?: number; status?: string }): Promise<unknown> {
  let query = supabase.from('medicao').select('*');
  if (params.obra_id) query = query.eq('id_obracada', params.obra_id);
  if (params.status) query = query.eq('status', params.status);
  const { data, error } = await query;
  if (error) throw new Error(`query_medicoes: ${error.message}`);
  return data;
}

// Tool definitions for Claude Agent SDK
export const toolDefinitions = [
  { name: 'query_lancamentos', description: 'Consulta lançamentos financeiros (contas a pagar/receber) com filtros', input_schema: { type: 'object' as const, properties: { status: { type: 'string' }, tipo: { type: 'string' }, obra_id: { type: 'number' }, vencimento_ate: { type: 'string', description: 'Data limite YYYY-MM-DD' }, limit: { type: 'number' } } } },
  { name: 'create_lancamento', description: 'Cria novo lançamento financeiro', input_schema: { type: 'object' as const, properties: { descricao: { type: 'string' }, valor: { type: 'number' }, tipo: { type: 'string', description: 'pagar ou receber' }, id_obracada: { type: 'number' }, data_vencimento: { type: 'string' } }, required: ['descricao', 'valor', 'tipo', 'data_vencimento'] } },
  { name: 'update_lancamento', description: 'Atualiza lançamento existente', input_schema: { type: 'object' as const, properties: { id: { type: 'number' }, status: { type: 'string' }, valor: { type: 'number' }, data_pagamento: { type: 'string' } }, required: ['id'] } },
  { name: 'query_contas_bancarias', description: 'Consulta contas bancárias e saldos', input_schema: { type: 'object' as const, properties: { limit: { type: 'number' } } } },
  { name: 'projecao_fluxo_caixa', description: 'Projeta fluxo de caixa futuro baseado em lançamentos pendentes', input_schema: { type: 'object' as const, properties: { meses: { type: 'number', description: 'Meses à frente (default 3)' } } } },
  { name: 'alertar_vencimento', description: 'Lista lançamentos vencendo nos próximos N dias', input_schema: { type: 'object' as const, properties: { dias: { type: 'number', description: 'Dias à frente (default 7)' } } } },
  { name: 'fechamento_mensal', description: 'Consolida dados financeiros do mês para fechamento', input_schema: { type: 'object' as const, properties: { mes: { type: 'number' }, ano: { type: 'number' } }, required: ['mes', 'ano'] } },
  { name: 'preparar_docs_contabilidade', description: 'Gera pacote de documentos para o contador', input_schema: { type: 'object' as const, properties: { mes: { type: 'number' }, ano: { type: 'number' } }, required: ['mes', 'ano'] } },
  { name: 'avaliar_nf_centro_custo', description: 'Analisa NFs por obra/centro de custo para verificar responsabilidade de pagamento ANF', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' }, periodo_inicio: { type: 'string' }, periodo_fim: { type: 'string' } }, required: ['obra_id'] } },
  { name: 'solicitar_guias_impostos', description: 'Registra solicitação de guias de impostos para contabilidade', input_schema: { type: 'object' as const, properties: { nf_ids: { type: 'array', items: { type: 'number' } }, descricao: { type: 'string' } }, required: ['nf_ids', 'descricao'] } },
  { name: 'emitir_nf', description: 'Emissão de NF de saída (a ser implantado)', input_schema: { type: 'object' as const, properties: { descricao: { type: 'string' }, valor: { type: 'number' }, destinatario: { type: 'string' } }, required: ['descricao', 'valor', 'destinatario'] } },
  { name: 'query_rh_folha', description: 'Consulta dados de folha de pagamento', input_schema: { type: 'object' as const, properties: { mes: { type: 'number' }, ano: { type: 'number' } } } },
  { name: 'query_adiantamentos', description: 'Consulta adiantamentos de colaboradores', input_schema: { type: 'object' as const, properties: { colaborador_id: { type: 'number' }, status: { type: 'string' } } } },
  { name: 'acompanhar_emprestimos', description: 'Monitora empréstimos de colaboradores — parcelas, saldos, vencimentos', input_schema: { type: 'object' as const, properties: { status: { type: 'string' } } } },
  { name: 'gerar_relatorio_folha', description: 'Gera relatório consolidado de folha para fechamento', input_schema: { type: 'object' as const, properties: { mes: { type: 'number' }, ano: { type: 'number' } }, required: ['mes', 'ano'] } },
  { name: 'query_obracada', description: 'Consulta dados financeiros das obras', input_schema: { type: 'object' as const, properties: { id: { type: 'number' }, status: { type: 'string' } } } },
  { name: 'query_medicoes', description: 'Consulta medições de obra (impacto financeiro)', input_schema: { type: 'object' as const, properties: { obra_id: { type: 'number' }, status: { type: 'string' } } } },
] as const;

export const toolHandlers: Record<string, (params: any) => Promise<unknown>> = {
  query_lancamentos, create_lancamento, update_lancamento, query_contas_bancarias,
  projecao_fluxo_caixa, alertar_vencimento, fechamento_mensal, preparar_docs_contabilidade,
  avaliar_nf_centro_custo, solicitar_guias_impostos, emitir_nf, query_rh_folha,
  query_adiantamentos, acompanhar_emprestimos, gerar_relatorio_folha, query_obracada, query_medicoes,
};
