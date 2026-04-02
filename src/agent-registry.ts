import type Anthropic from '@anthropic-ai/sdk';

// OrcaBot agents
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
  definitions: Anthropic.Tool[];
  handlers: Record<string, (params: any) => Promise<unknown>>;
}

const registry: Record<string, AgentToolset> = {
  // OrcaBot agents
  orcamentista: {
    definitions: orcamentistaDefs as unknown as Anthropic.Tool[],
    handlers: orcamentistaHandlers,
  },
  estrutural: {
    definitions: estruturalDefs as unknown as Anthropic.Tool[],
    handlers: estruturalHandlers,
  },
  hidraulico: {
    definitions: hidraulicoDefs as unknown as Anthropic.Tool[],
    handlers: hidraulicoHandlers,
  },
  eletricista: {
    definitions: eletricistaDefs as unknown as Anthropic.Tool[],
    handlers: eletricistaHandlers,
  },
};

export function getAgentTools(slug: string): AgentToolset | null {
  return registry[slug] || null;
}

export function getAllAgentSlugs(): string[] {
  return Object.keys(registry);
}
