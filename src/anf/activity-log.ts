import { supabase } from '../supabase-client.js';

export interface ActivityLogEntry {
  agent_id: string;
  task_id?: string;
  action: 'read' | 'write' | 'decision' | 'escalation' | 'error';
  target_table?: string;
  target_id?: string;
  description: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  tokens_used?: number;
  cost_usd?: number;
  duration_ms?: number;
}

export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  const { error } = await supabase.from('nano_activity_log').insert(entry);
  if (error) {
    console.error('[activity-log] Failed to log:', error.message, entry.description);
  }
}
