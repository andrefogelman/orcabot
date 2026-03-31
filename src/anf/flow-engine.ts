import { supabase } from '../supabase-client.js';
import { runAgent } from './agent-runner.js';
import { getAgentTools } from './agent-registry.js';
import { logActivity } from './activity-log.js';
import { notifyAdmin } from './whatsapp.js';

interface FlowNode {
  id: string;
  type: 'trigger' | 'agent' | 'decision' | 'escalate' | 'wait' | 'notify';
  data: Record<string, any>;
  position: { x: number; y: number };
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

interface Flow {
  id: string;
  name: string;
  trigger: { type: string; table?: string; event?: string; cron?: string };
  nodes: { nodes: FlowNode[]; edges: FlowEdge[] };
  enabled: boolean;
}

let loadedFlows: Flow[] = [];

export async function loadFlows(): Promise<void> {
  const { data, error } = await supabase
    .from('nano_flows')
    .select('*')
    .eq('enabled', true);
  if (error) {
    console.error('[flow-engine] Failed to load flows:', error.message);
    return;
  }
  loadedFlows = (data || []) as Flow[];
  console.log(`[flow-engine] Loaded ${loadedFlows.length} flows`);
}

export function getFlowsForTrigger(table: string, event: string): Flow[] {
  return loadedFlows.filter(
    (f) => f.trigger.type === 'realtime' && f.trigger.table === table && f.trigger.event === event
  );
}

export async function executeFlow(flow: Flow, triggerData: Record<string, any>): Promise<void> {
  console.log(`[flow-engine] Executing flow: ${flow.name}`);
  const { nodes, edges } = flow.nodes;
  if (!nodes?.length) return;

  // Find trigger node (start)
  const triggerNode = nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) return;

  // Walk the graph
  let currentNodeId = triggerNode.id;
  const context: Record<string, any> = { trigger: triggerData, results: {} };

  for (let step = 0; step < 20; step++) {
    const outEdges = edges.filter((e) => e.source === currentNodeId);
    if (!outEdges.length) break;

    // For decision nodes, pick edge based on result
    let nextEdge = outEdges[0];
    const currentNode = nodes.find((n) => n.id === currentNodeId);

    if (currentNode?.type === 'decision' && context.lastResult !== undefined) {
      const yesEdge = outEdges.find((e) => e.sourceHandle === 'yes' || e.label === 'sim');
      const noEdge = outEdges.find((e) => e.sourceHandle === 'no' || e.label === 'não');
      nextEdge = context.lastResult ? (yesEdge || outEdges[0]) : (noEdge || outEdges[0]);
    }

    const nextNode = nodes.find((n) => n.id === nextEdge.target);
    if (!nextNode) break;

    try {
      const result = await executeNode(nextNode, context);
      context.results[nextNode.id] = result;
      if (nextNode.type === 'decision') {
        context.lastResult = result;
      }
    } catch (err: any) {
      console.error(`[flow-engine] Node ${nextNode.id} failed:`, err.message);
      break;
    }

    currentNodeId = nextNode.id;

    // Stop on escalate
    if (nextNode.type === 'escalate') break;
  }

  console.log(`[flow-engine] Flow "${flow.name}" completed`);
}

async function executeNode(node: FlowNode, context: Record<string, any>): Promise<any> {
  switch (node.type) {
    case 'agent': {
      const agentSlug = node.data.agent;
      const toolName = node.data.tool;
      const tools = getAgentTools(agentSlug);
      if (!tools) throw new Error(`Agent ${agentSlug} not found`);

      if (toolName && tools.handlers[toolName]) {
        // Direct tool call
        const params = { ...node.data.params, ...context.trigger };
        return await tools.handlers[toolName](params);
      }

      // Full agent invocation
      const taskDescription = node.data.task || `Execute flow step: ${JSON.stringify(node.data)}`;
      const result = await runAgent(agentSlug, taskDescription, tools.definitions, tools.handlers);
      return result.response;
    }

    case 'decision': {
      const field = node.data.field || 'value';
      const operator = node.data.operator || '>';
      const threshold = node.data.threshold || 0;
      const value = context.trigger[field] || context.results[Object.keys(context.results).pop() || ''];

      switch (operator) {
        case '>': return Number(value) > Number(threshold);
        case '<': return Number(value) < Number(threshold);
        case '==': return String(value) === String(threshold);
        case '!=': return String(value) !== String(threshold);
        case 'contains': return String(value).includes(String(threshold));
        default: return false;
      }
    }

    case 'escalate': {
      const message = node.data.message || 'Escalação de fluxo automático';
      await notifyAdmin(`🚨 Escalação: ${message}`);

      const { data: orq } = await supabase.from('nano_agents').select('id').eq('slug', 'orquestrador').single();
      if (orq) {
        await logActivity({
          agent_id: orq.id,
          action: 'escalation',
          description: `Flow escalation: ${message}`,
          input: context.trigger,
        });
      }
      return { escalated: true, message };
    }

    case 'notify': {
      const message = node.data.message || 'Notificação de fluxo';
      await notifyAdmin(message);
      return { notified: true };
    }

    case 'wait': {
      const delayMs = (node.data.minutes || 1) * 60 * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 300000))); // max 5 min
      return { waited: true, minutes: node.data.minutes };
    }

    default:
      return null;
  }
}
