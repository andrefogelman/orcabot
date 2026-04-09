import { supabase, supabaseRealtime } from '../supabase-client.js';
import { routeEvent } from './router.js';
import { runAgent } from './agent-runner.js';
import { logActivity } from './activity-log.js';
import { getAgentTools } from './agent-registry.js';
import { getFlowsForTrigger, executeFlow } from './flow-engine.js';

const SUBSCRIPTIONS = [
  // Suprimentos
  { table: 'requisicao', event: 'INSERT' as const },
  { table: 'requisicao', event: 'UPDATE' as const },
  { table: 'proposta_analise', event: 'INSERT' as const },
  { table: 'requisicao_envio_tracking', event: 'UPDATE' as const },
  { table: 'email_document_scan', event: 'INSERT' as const },
  // Financeiro
  // NOTE: lanca and medicao must be enabled for Realtime publication via SQL:
  //   ALTER PUBLICATION supabase_realtime ADD TABLE lanca;
  //   ALTER PUBLICATION supabase_realtime ADD TABLE medicao;
  { table: 'lanca', event: 'INSERT' as const },
  { table: 'lanca', event: 'UPDATE' as const },
  // Engenharia
  { table: 'medicao', event: 'INSERT' as const },
  { table: 'medicao', event: 'UPDATE' as const },
  { table: 'obracada', event: 'UPDATE' as const },
  // Orcamentista
  { table: 'ob_processing_runs', event: 'UPDATE' as const },
] as const;

export function startRealtimeListener(): void {
  const channel = supabaseRealtime.channel('nano-realtime');

  for (const sub of SUBSCRIPTIONS) {
    channel.on(
      'postgres_changes',
      { event: sub.event, schema: 'public', table: sub.table },
      async (payload) => {
        const agentSlug = routeEvent(sub.table, sub.event);
        if (!agentSlug) return;

        const tools = getAgentTools(agentSlug);
        if (!tools) {
          console.log(`[realtime] Agent ${agentSlug} not registered, skipping`);
          return;
        }

        const taskDescription = buildTaskDescription(
          sub.table,
          sub.event,
          payload.new,
        );
        console.log(
          `[realtime] ${sub.table}.${sub.event} → ${agentSlug}: ${taskDescription.slice(0, 80)}`,
        );

        try {
          const result = await runAgent(
            agentSlug,
            taskDescription,
            tools.definitions,
            tools.handlers,
          );
          console.log(
            `[realtime] ${agentSlug} done: ${result.response.slice(0, 100)}`,
          );
        } catch (err: any) {
          console.error(`[realtime] ${agentSlug} error:`, err.message);
          const { data: agent } = await supabase
            .from('nano_agents')
            .select('id')
            .eq('slug', agentSlug)
            .single();
          if (agent) {
            await logActivity({
              agent_id: agent.id,
              action: 'error',
              target_table: sub.table,
              description: `Realtime handler failed: ${err.message}`,
              input: payload.new as Record<string, unknown>,
            });
          }
        }

        // Check for matching flows
        const matchingFlows = getFlowsForTrigger(sub.table, sub.event);
        for (const flow of matchingFlows) {
          try {
            await executeFlow(flow, payload.new as Record<string, any>);
          } catch (err: any) {
            console.error(`[realtime] Flow "${flow.name}" error:`, err.message);
          }
        }
      },
    );
  }

  channel.subscribe((status) => {
    console.log(`[realtime] Subscription status: ${status}`);
  });

  console.log(
    '[realtime] Listening on:',
    SUBSCRIPTIONS.map((s) => `${s.table}.${s.event}`).join(', '),
  );
}

function buildTaskDescription(
  table: string,
  event: string,
  record: any,
): string {
  switch (table) {
    case 'requisicao':
      if (event === 'INSERT')
        return `Nova requisição de compra recebida (ID: ${record.id}). Analise, identifique fornecedores, inicie cotação. Descrição: ${record.descricao || 'N/A'}`;
      return `Requisição ${record.id} atualizada (status: ${record.status}). Verifique se ação necessária.`;
    case 'proposta_analise':
      return `Nova proposta de fornecedor (ID: ${record.id}). Analise preço, prazo e condições.`;
    case 'requisicao_envio_tracking':
      return `Tracking atualizado (ID: ${record.id}, status: ${record.status}). Verifique follow-up.`;
    case 'email_document_scan':
      return `Novo email de compras (ID: ${record.id}). Verifique se é resposta de fornecedor.`;
    case 'lanca':
      if (event === 'INSERT')
        return `Novo lançamento financeiro (ID: ${record.id}). Classifique, verifique vencimento. Descrição: ${record.descricao || 'N/A'}, Valor: R$${record.valor || '?'}`;
      return `Lançamento ${record.id} atualizado (status: ${record.status}). Verifique impacto.`;
    case 'medicao':
      if (event === 'INSERT')
        return `Nova medição registrada (ID: ${record.id}). Avalie e aprove/rejeite.`;
      return `Medição ${record.id} atualizada (status: ${record.status}). Verifique ação necessária.`;
    case 'obracada':
      return `Obra ${record.id} atualizada (status: ${record.status}). Verifique cronograma e orçamento.`;
    case 'ob_processing_runs':
      return `Processamento de PDF concluído (run_id: ${record.id}, project_id: ${record.project_id}, status: ${record.status}). Use get_extraction_data para ler os dados extraídos e process_pdf_results para analisar as pranchas. Em seguida, crie quantitativos com create_quantitativo para cada item encontrado.`;
    default:
      return `Evento ${event} na tabela ${table}: ${JSON.stringify(record).slice(0, 200)}`;
  }
}
