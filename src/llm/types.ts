// src/llm/types.ts
// Unified LLM provider interface — provider-agnostic types for chat and tool-use.

export interface Message {
  role: 'user' | 'assistant' | 'model';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  is_error?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface ChatOpts {
  model: string;
  system: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

export interface ToolChatOpts extends ChatOpts {
  tools: ToolDef[];
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ToolChatResult extends ChatResult {
  stopReason: 'end' | 'tool_use';
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
}

export interface LlmProvider {
  chat(opts: ChatOpts): Promise<ChatResult>;
  chatWithTools(opts: ToolChatOpts): Promise<ToolChatResult>;
}
