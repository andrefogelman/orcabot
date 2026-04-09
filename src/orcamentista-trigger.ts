// src/orcamentista-trigger.ts
// Triggers the orcamentista agent after DXF/PDF extraction.

import { getAgentTools } from './agent-registry.js';
import { runOrcabotAgent, type AgentRunResult } from './orcabot-agent-runner.js';
import { supabaseAdmin } from './supabase-client.js';
import { logger } from './logger.js';

export interface TriggerParams {
  projectId: string;
  runId: string | null;
  fileId: string;
  extractedText: string;
  fileInfo: string;
  userPrompt: string;
  pdfContext: string;
}

export async function triggerOrcamentista(params: TriggerParams): Promise<AgentRunResult> {
  const tools = getAgentTools('orcamentista');
  if (!tools) throw new Error('Orcamentista agent not found in registry');

  // Update processing run status
  if (params.runId) {
    await supabaseAdmin
      .from('ob_processing_runs')
      .update({ status: 'agent_processing' })
      .eq('id', params.runId);
  }

  const taskDescription = `
## Tarefa de Levantamento Quantitativo

**Projeto**: ${params.projectId}
**Arquivo**: ${params.fileId}
**Tipo**: ${params.fileInfo}

### Instrução do Usuário
${params.userPrompt}

### Dados Extraídos do Arquivo (geometria DXF/PDF)
${params.extractedText.slice(0, 15000)}
${params.pdfContext ? `\n### Dados de Referência (PDFs do mesmo projeto)\n${params.pdfContext.slice(0, 8000)}` : ''}

### Fluxo Obrigatório
1. Use a tool \`get_extraction_data\` para ler os dados estruturados da extração (run_id: ${params.runId || 'mais recente'}).
2. Analise os dados e identifique disciplinas presentes.
3. Para dados ARQUITETÔNICOS (áreas, pisos, acabamentos, esquadrias): processe localmente usando \`create_quantitativo\`.
4. Para dados ESTRUTURAIS: delegue com \`delegate_to_specialist\` (to_agent: "estrutural").
5. Para dados HIDRÁULICOS: delegue com \`delegate_to_specialist\` (to_agent: "hidraulico").
6. Para dados ELÉTRICOS: delegue com \`delegate_to_specialist\` (to_agent: "eletricista").
7. SEMPRE crie quantitativos com \`create_quantitativo\`. Nunca retorne apenas texto descritivo.
8. Ao final, retorne um resumo do que foi levantado com contagem de itens por disciplina.

### Regras
- Cada item DEVE ter quantidade numérica > 0
- confidence < 0.7 marca automaticamente para revisão humana
- Use memorial_calculo para documentar como a quantidade foi obtida
- disciplinas aceitas: arq, est, hid, ele, geral
`.trim();

  logger.info(
    { projectId: params.projectId, runId: params.runId },
    '[orcamentista-trigger] Invoking orcamentista agent',
  );

  const result = await runOrcabotAgent(
    'orcamentista',
    taskDescription,
    tools.definitions,
    tools.handlers,
  );

  logger.info(
    {
      projectId: params.projectId,
      toolCalls: result.tool_calls.length,
      tokensUsed: result.tokens_used,
      durationMs: result.duration_ms,
    },
    '[orcamentista-trigger] Orcamentista agent finished',
  );

  // Update processing run with agent results
  if (params.runId) {
    const quantitativos = result.tool_calls
      .filter((tc) => tc.name === 'create_quantitativo')
      .map((tc) => tc.output);

    await supabaseAdmin
      .from('ob_processing_runs')
      .update({
        status: 'done',
        summary: result.response || `Orçamentista processou: ${quantitativos.length} quantitativos criados`,
        items: quantitativos,
        raw_response: {
          agent_response: result.response,
          tool_calls: result.tool_calls.map((tc) => ({ name: tc.name, input: tc.input })),
          tokens_used: result.tokens_used,
          duration_ms: result.duration_ms,
        },
        pages_processed: 1,
      })
      .eq('id', params.runId);
  }

  return result;
}
