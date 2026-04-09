import type Anthropic from '@anthropic-ai/sdk';

import {
  toolDefinitions as suprimentosDefs,
  toolHandlers as suprimentosHandlers,
} from '../../agents/suprimentos/tools.js';
import {
  toolDefinitions as financeiroDefs,
  toolHandlers as financeiroHandlers,
} from '../../agents/financeiro/tools.js';
import {
  toolDefinitions as engenhariaDefs,
  toolHandlers as engenhariaHandlers,
} from '../../agents/engenharia/tools.js';
import {
  toolDefinitions as orquestradorDefs,
  toolHandlers as orquestradorHandlers,
} from '../../agents/orquestrador/tools.js';
import {
  toolDefinitions as orcamentistaDefs,
  toolHandlers as orcamentistaHandlers,
} from '../../agents/orcamentista/tools.js';

export interface AgentToolset {
  definitions: Anthropic.Tool[];
  handlers: Record<string, (params: any) => Promise<unknown>>;
}

const registry: Record<string, AgentToolset> = {
  suprimentos: {
    definitions: suprimentosDefs as unknown as Anthropic.Tool[],
    handlers: suprimentosHandlers,
  },
  financeiro: {
    definitions: financeiroDefs as unknown as Anthropic.Tool[],
    handlers: financeiroHandlers,
  },
  engenharia: {
    definitions: engenhariaDefs as unknown as Anthropic.Tool[],
    handlers: engenhariaHandlers,
  },
  orquestrador: {
    definitions: orquestradorDefs as unknown as Anthropic.Tool[],
    handlers: orquestradorHandlers,
  },
  orcamentista: {
    definitions: orcamentistaDefs as unknown as Anthropic.Tool[],
    handlers: orcamentistaHandlers,
  },
};

export function getAgentTools(slug: string): AgentToolset | null {
  return registry[slug] || null;
}

export function getAllAgentSlugs(): string[] {
  return Object.keys(registry);
}
