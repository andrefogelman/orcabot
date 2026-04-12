import type { ToolDef } from './llm/types.js';

import {
  toolDefinitions as orcamentistaDefs,
  toolHandlers as orcamentistaHandlers,
} from '../agents/orcamentista/tools.js';
import {
  toolDefinitions as estruturalDefs,
  toolHandlers as estruturalHandlers,
} from '../agents/estrutural/tools.js';
import {
  toolDefinitions as hidraulicoDefs,
  toolHandlers as hidraulicoHandlers,
} from '../agents/hidraulico/tools.js';
import {
  toolDefinitions as eletricistaDefs,
  toolHandlers as eletricistaHandlers,
} from '../agents/eletricista/tools.js';

export interface AgentToolset {
  definitions: ToolDef[];
  handlers: Record<string, (params: any) => Promise<unknown>>;
}

/**
 * Convert Anthropic-style tool defs (input_schema) to unified ToolDef (parameters).
 */
function toUnifiedDefs(
  defs: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>,
): ToolDef[] {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.input_schema,
  }));
}

const registry: Record<string, AgentToolset> = {
  orcamentista: {
    definitions: toUnifiedDefs(orcamentistaDefs as any),
    handlers: orcamentistaHandlers,
  },
  estrutural: {
    definitions: toUnifiedDefs(estruturalDefs as any),
    handlers: estruturalHandlers,
  },
  hidraulico: {
    definitions: toUnifiedDefs(hidraulicoDefs as any),
    handlers: hidraulicoHandlers,
  },
  eletricista: {
    definitions: toUnifiedDefs(eletricistaDefs as any),
    handlers: eletricistaHandlers,
  },
};

export function getAgentTools(slug: string): AgentToolset | null {
  return registry[slug] || null;
}

export function getAllAgentSlugs(): string[] {
  return Object.keys(registry);
}
