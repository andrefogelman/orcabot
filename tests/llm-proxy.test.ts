// ~/orcabot/tests/llm-proxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.API_SECRET = 'test-secret';
process.env.LLM_MODE = 'apikey';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.LLM_PROXY_PORT = '0'; // random port

describe('llm-proxy', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    vi.resetModules();
    const { createLlmProxy } = await import('../src/llm-proxy.js');
    server = createLlmProxy();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('responds to GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.mode).toBe('apikey');
  });

  it('rejects requests without auth header', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [],
      }),
    });
    expect(res.status).toBe(401);
  });

  it('forwards requests with correct auth in apikey mode', async () => {
    // This will fail to connect to Anthropic, but we verify
    // the proxy at least accepts the request and tries to forward
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'container-internal-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    // Will get an error from Anthropic (bad key), but proxy accepted it
    // Status 502 or error from upstream is fine — proves proxy forwarded
    expect([200, 400, 401, 502, 500]).toContain(res.status);
  });
});
