// src/llm/index.ts
// Factory singleton — selects LLM provider based on LLM_PROVIDER env var.

import type { LlmProvider } from './types.js';

export type {
  LlmProvider,
  ChatOpts,
  ChatResult,
  ToolChatOpts,
  ToolChatResult,
  ToolDef,
  Message,
  ContentBlock,
} from './types.js';

let _provider: LlmProvider | null = null;

export async function getProvider(): Promise<LlmProvider> {
  if (_provider) return _provider;

  const name = process.env.LLM_PROVIDER || 'gemini';

  if (name === 'gemini') {
    const { GeminiProvider } = await import('./gemini-provider.js');
    _provider = new GeminiProvider();
  } else if (name === 'anthropic') {
    const { AnthropicProvider } = await import('./anthropic-provider.js');
    _provider = new AnthropicProvider();
  } else {
    throw new Error(`Unknown LLM_PROVIDER: ${name}`);
  }

  return _provider;
}
