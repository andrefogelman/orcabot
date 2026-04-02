import { supabase } from '../supabase-client.js';
import { runAgent } from './agent-runner.js';
import { getAgentTools } from './agent-registry.js';
import { logActivity } from './activity-log.js';
import { notifyAdmin } from './whatsapp.js';

let running = false;

export async function processPendingTasks(): Promise<void> {
  // Fetch pending tasks with their assigned agent
  const { data: tasks, error } = await supabase
    .from('nano_tasks')
    .select('*, nano_agents!assigned_to(id, slug, name, emoji, status)')
    .eq('status', 'pending')
    .order('priority', { ascending: true }) // urgent first (alphabetical: high < low < normal < urgent — need custom order)
    .order('created_at', { ascending: true })
    .limit(5);

  if (error || !tasks?.length) return;

  for (const task of tasks) {
    const agent = (task as any).nano_agents;
    if (!agent || agent.status !== 'active') {
      console.log(
        `[task-executor] Skipping task ${task.id}: agent inactive or not found`,
      );
      continue;
    }

    const tools = getAgentTools(agent.slug);
    if (!tools) {
      console.log(
        `[task-executor] Skipping task ${task.id}: no tools for ${agent.slug}`,
      );
      continue;
    }

    // Mark as in_progress
    await supabase
      .from('nano_tasks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', task.id);

    console.log(`[task-executor] Running task "${task.title}" → ${agent.slug}`);

    try {
      const taskPrompt = [
        `Tarefa atribuída a você: "${task.title}"`,
        '',
        `Descrição: ${task.description}`,
        '',
        task.context && Object.keys(task.context).length > 0
          ? `Contexto adicional: ${JSON.stringify(task.context)}`
          : '',
        '',
        task.admin_feedback
          ? `Feedback anterior do admin: ${task.admin_feedback}`
          : '',
        '',
        'Execute a tarefa e reporte o resultado de forma clara e objetiva.',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await runAgent(
        agent.slug,
        taskPrompt,
        tools.definitions,
        tools.handlers,
      );

      // Mark as completed
      await supabase
        .from('nano_tasks')
        .update({
          status: 'completed',
          result: result.response,
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      await logActivity({
        agent_id: agent.id,
        task_id: task.id,
        action: 'decision',
        description: `Tarefa concluída: "${task.title}"`,
        tokens_used: result.tokens_used,
        cost_usd: result.cost_usd,
        duration_ms: result.duration_ms,
        output: { response: result.response.slice(0, 500) },
      });

      console.log(
        `[task-executor] Task "${task.title}" completed by ${agent.slug}`,
      );
    } catch (err: any) {
      const newRetry = (task.retry_count || 0) + 1;
      const maxRetries = task.max_retries || 3;
      const newStatus = newRetry >= maxRetries ? 'failed' : 'pending';

      await supabase
        .from('nano_tasks')
        .update({
          status: newStatus,
          retry_count: newRetry,
          result: `Erro: ${err.message}`,
        })
        .eq('id', task.id);

      await logActivity({
        agent_id: agent.id,
        task_id: task.id,
        action: 'error',
        description: `Tarefa falhou (tentativa ${newRetry}/${maxRetries}): ${err.message}`,
      });

      if (newStatus === 'failed') {
        await notifyAdmin(
          `❌ Tarefa "${task.title}" falhou após ${maxRetries} tentativas: ${err.message}`,
        );
      }

      console.error(
        `[task-executor] Task "${task.title}" failed (${newRetry}/${maxRetries}):`,
        err.message,
      );
    }
  }
}

export function startTaskExecutor(intervalMs: number = 15000): void {
  if (running) return;
  running = true;
  console.log(
    `[task-executor] Polling every ${intervalMs / 1000}s for pending tasks`,
  );

  async function poll() {
    if (!running) return;
    try {
      await processPendingTasks();
    } catch (err: any) {
      console.error('[task-executor] Polling error:', err.message);
    }
    setTimeout(poll, intervalMs);
  }

  poll();
}

export function stopTaskExecutor(): void {
  running = false;
}
