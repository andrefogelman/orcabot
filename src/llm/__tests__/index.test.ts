import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock both providers
vi.mock('../gemini-provider.js', () => ({
  GeminiProvider: vi.fn(function (this: Record<string, unknown>) {
    this.chat = vi.fn();
    this.chatWithTools = vi.fn();
  }),
}));

vi.mock('../anthropic-provider.js', () => ({
  AnthropicProvider: vi.fn(function (this: Record<string, unknown>) {
    this.chat = vi.fn();
    this.chatWithTools = vi.fn();
  }),
}));

describe('getProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('returns GeminiProvider by default', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini');
    vi.stubEnv('GOOGLE_API_KEY', 'test');
    const { getProvider } = await import('../index.js');
    const provider = await getProvider();
    expect(provider).toBeDefined();
    expect(provider.chat).toBeDefined();
    expect(provider.chatWithTools).toBeDefined();
  });

  it('returns AnthropicProvider when configured', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    const { getProvider } = await import('../index.js');
    const provider = await getProvider();
    expect(provider).toBeDefined();
  });

  it('throws on unknown provider', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    const { getProvider } = await import('../index.js');
    await expect(getProvider()).rejects.toThrow('Unknown LLM_PROVIDER: openai');
  });

  it('returns same instance on repeated calls', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini');
    vi.stubEnv('GOOGLE_API_KEY', 'test');
    const { getProvider } = await import('../index.js');
    const a = await getProvider();
    const b = await getProvider();
    expect(a).toBe(b);
  });
});
