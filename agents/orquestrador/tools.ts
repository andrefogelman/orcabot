import { supabase } from '../../src/supabase-client.js';
import { logActivity } from '../../src/anf/activity-log.js';

const AGENT_SLUG = 'orquestrador';

async function getAgentId(): Promise<string> {
  const { data } = await supabase.from('nano_agents').select('id').eq('slug', AGENT_SLUG).single();
  return data!.id;
}

// 1. delegate_task
export async function delegate_task(params: { agent_slug: string; title: string; description: string; priority?: string; context?: Record<string, unknown> }): Promise<unknown> {
  const orqId = await getAgentId();
  const { data: targetAgent } = await supabase.from('nano_agents').select('id, name').eq('slug', params.agent_slug).single();
  if (!targetAgent) throw new Error(`Agente ${params.agent_slug} não encontrado`);
  const { data, error } = await supabase.from('nano_tasks').insert({ title: params.title, description: params.description, assigned_to: targetAgent.id, created_by: orqId, priority: params.priority || 'normal', context: params.context || {} }).select().single();
  if (error) throw new Error(`delegate_task: ${error.message}`);
  await logActivity({ agent_id: orqId, action: 'write', target_table: 'nano_tasks', target_id: data.id, description: `Delegou "${params.title}" para ${targetAgent.name}`, input: params as unknown as Record<string, unknown> });
  return data;
}

// 2. check_agent_status
export async function check_agent_status(params: { agent_slug?: string }): Promise<unknown> {
  let query = supabase.from('nano_agents').select('slug, name, emoji, status, config');
  if (params.agent_slug) query = query.eq('slug', params.agent_slug);
  const { data: agents, error } = await query;
  if (error) throw new Error(`check_agent_status: ${error.message}`);
  const result = [];
  for (const agent of agents || []) {
    const { count: pendingTasks } = await supabase.from('nano_tasks').select('*', { count: 'exact', head: true }).eq('assigned_to', agent.slug).in('status', ['pending', 'in_progress']);
    const { data: lastActivity } = await supabase.from('nano_activity_log').select('description, created_at').eq('agent_id', agent.slug).order('created_at', { ascending: false }).limit(1);
    result.push({ ...agent, pending_tasks: pendingTasks || 0, last_activity: lastActivity?.[0] || null });
  }
  return result;
}

// 3. escalate_to_admin
export async function escalate_to_admin(params: { message: string; urgency: string; context?: Record<string, unknown> }): Promise<unknown> {
  const orqId = await getAgentId();
  const { data, error } = await supabase.from('nano_messages').insert({ agent_id: orqId, role: 'agent', content: `[ESCALAÇÃO ${params.urgency.toUpperCase()}] ${params.message}` }).select().single();
  if (error) throw new Error(`escalate_to_admin: ${error.message}`);
  await logActivity({ agent_id: orqId, action: 'escalation', description: `Escalação ${params.urgency}: ${params.message}`, input: params.context });
  return { status: 'escalated', message_id: data.id };
}

// 4. review_task_result
export async function review_task_result(params: { task_id: string; approved: boolean; feedback: string }): Promise<unknown> {
  const orqId = await getAgentId();
  const newStatus = params.approved ? 'completed' : 'pending';
  const updates: Record<string, unknown> = { status: newStatus, admin_feedback: params.feedback };
  const { data, error } = await supabase.from('nano_tasks').update(updates).eq('id', params.task_id).select().single();
  if (error) throw new Error(`review_task_result: ${error.message}`);
  if (!params.approved) {
    await supabase.from('nano_tasks').update({ retry_count: (data.retry_count || 0) + 1 }).eq('id', params.task_id);
  }
  await logActivity({ agent_id: orqId, action: 'decision', target_table: 'nano_tasks', target_id: params.task_id, description: `Review: ${params.approved ? 'aprovado' : 'devolvido'} — ${params.feedback}` });
  return data;
}

// 5. get_pending_tasks
export async function get_pending_tasks(params: { agent_slug?: string; status?: string }): Promise<unknown> {
  let query = supabase.from('nano_tasks').select('*, nano_agents!assigned_to(slug, name)').order('created_at', { ascending: false }).limit(30);
  if (params.status) query = query.eq('status', params.status);
  else query = query.in('status', ['pending', 'in_progress', 'review', 'escalated']);
  const { data, error } = await query;
  if (error) throw new Error(`get_pending_tasks: ${error.message}`);
  return data;
}

// 6. query_activity_log
export async function query_activity_log(params: { agent_slug?: string; action?: string; limit?: number }): Promise<unknown> {
  let query = supabase.from('nano_activity_log').select('*').order('created_at', { ascending: false }).limit(params.limit || 20);
  if (params.action) query = query.eq('action', params.action);
  const { data, error } = await query;
  if (error) throw new Error(`query_activity_log: ${error.message}`);
  return data;
}

export const toolDefinitions = [
  { name: 'delegate_task', description: 'Delega tarefa a um agente subordinado', input_schema: { type: 'object' as const, properties: { agent_slug: { type: 'string', description: 'financeiro, suprimentos, ou engenharia' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, context: { type: 'object' } }, required: ['agent_slug', 'title', 'description'] } },
  { name: 'check_agent_status', description: 'Consulta status e saúde dos agentes', input_schema: { type: 'object' as const, properties: { agent_slug: { type: 'string' } } } },
  { name: 'escalate_to_admin', description: 'Escala situação ao admin para decisão humana', input_schema: { type: 'object' as const, properties: { message: { type: 'string' }, urgency: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] }, context: { type: 'object' } }, required: ['message', 'urgency'] } },
  { name: 'review_task_result', description: 'Avalia resultado de tarefa — aprova ou devolve', input_schema: { type: 'object' as const, properties: { task_id: { type: 'string' }, approved: { type: 'boolean' }, feedback: { type: 'string' } }, required: ['task_id', 'approved', 'feedback'] } },
  { name: 'get_pending_tasks', description: 'Lista tarefas pendentes de todos os agentes', input_schema: { type: 'object' as const, properties: { agent_slug: { type: 'string' }, status: { type: 'string' } } } },
  { name: 'query_activity_log', description: 'Consulta histórico de ações dos agentes', input_schema: { type: 'object' as const, properties: { agent_slug: { type: 'string' }, action: { type: 'string' }, limit: { type: 'number' } } } },
] as const;

export const toolHandlers: Record<string, (params: any) => Promise<unknown>> = {
  delegate_task, check_agent_status, escalate_to_admin,
  review_task_result, get_pending_tasks, query_activity_log,
};
