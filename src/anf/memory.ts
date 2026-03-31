import { supabase } from '../supabase-client.js';

export interface Memory {
  id: string;
  agent_id: string;
  category: 'aprendizado' | 'feedback' | 'regra' | 'contexto';
  title: string;
  content: string;
  source: 'chat' | 'task_feedback' | 'admin_edit' | 'document';
  relevance_score: number;
  pinned: boolean;
}

export async function saveMemory(params: {
  agent_id: string;
  category: Memory['category'];
  title: string;
  content: string;
  source: Memory['source'];
}): Promise<Memory> {
  const { data, error } = await supabase
    .from('nano_memory')
    .insert(params)
    .select()
    .single();
  if (error) throw new Error(`saveMemory: ${error.message}`);
  console.log(`[memory] Saved for agent ${params.agent_id}: ${params.title}`);
  return data as Memory;
}

export async function getRelevantMemories(
  agent_id: string,
  limit: number = 20
): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('nano_memory')
    .select('*')
    .eq('agent_id', agent_id)
    .order('relevance_score', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRelevantMemories: ${error.message}`);
  return (data || []) as Memory[];
}

export async function reinforceMemory(memory_id: string, positive: boolean): Promise<void> {
  const { data: current } = await supabase
    .from('nano_memory')
    .select('relevance_score, pinned')
    .eq('id', memory_id)
    .single();

  if (!current || current.pinned) return;

  const delta = positive ? 0.2 : -0.1;
  const newScore = Math.max(0, Math.min(5.0, current.relevance_score + delta));

  await supabase
    .from('nano_memory')
    .update({ relevance_score: newScore })
    .eq('id', memory_id);

  console.log(`[memory] ${memory_id} score: ${current.relevance_score} → ${newScore}`);
}

export async function decayMemories(): Promise<number> {
  // Monthly decay: score *= 0.9 for non-pinned memories not updated in 90 days
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 90);

  const { data: stale } = await supabase
    .from('nano_memory')
    .select('id, relevance_score')
    .eq('pinned', false)
    .lt('updated_at', threshold.toISOString())
    .gt('relevance_score', 0.2);

  if (!stale?.length) return 0;

  for (const mem of stale) {
    await supabase
      .from('nano_memory')
      .update({ relevance_score: mem.relevance_score * 0.9 })
      .eq('id', mem.id);
  }

  console.log(`[memory] Decayed ${stale.length} memories`);
  return stale.length;
}
