import { supabase } from '../supabase-client.js';
import { searchDocuments, searchMemories } from './embeddings.js';

export interface AgentContext {
  agent_id: string;
  slug: string;
  system_prompt: string;
  model: string;
  temperature: number;
  config: Record<string, unknown>;
  memories: Array<{ title: string; content: string; category: string }>;
  documents: Array<{ title: string; content: string; doc_type: string }>;
  recent_activity: Array<{ action: string; description: string; created_at: string }>;
  pending_messages: Array<{ role: string; content: string; created_at: string }>;
}

export async function buildAgentContext(
  slug: string,
  taskDescription: string
): Promise<AgentContext> {
  const { data: agent, error: agentErr } = await supabase
    .from('nano_agents')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single();

  if (agentErr || !agent) throw new Error(`Agent ${slug} not found or inactive`);

  const memories = await searchMemories(agent.id, taskDescription);
  const documents = await searchDocuments(agent.id, taskDescription);

  const { data: activity } = await supabase
    .from('nano_activity_log')
    .select('action, description, created_at')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: messages } = await supabase
    .from('nano_messages')
    .select('role, content, created_at')
    .eq('agent_id', agent.id)
    .eq('role', 'admin')
    .order('created_at', { ascending: false })
    .limit(10);

  return {
    agent_id: agent.id,
    slug: agent.slug,
    system_prompt: agent.system_prompt,
    model: agent.model,
    temperature: agent.temperature,
    config: agent.config,
    memories: memories || [],
    documents: documents || [],
    recent_activity: activity || [],
    pending_messages: messages || [],
  };
}
