// ~/orcabot/src/llm-proxy.ts
// Embedded LLM proxy — containers hit this instead of Anthropic directly.
// Dev: Claude Max session token (zero cost). Prod: Anthropic API key.

import http from 'http';
import https from 'https';
import { config } from './config.js';

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const CLAUDE_MAX_HOST = 'claude.ai';

interface ProxyConfig {
  mode: 'max' | 'apikey';
  apiKey: string;
  maxSessionToken: string;
  maxCookies: string;
}

function getProxyConfig(): ProxyConfig {
  return {
    mode: config.llmMode,
    apiKey: config.anthropicApiKey,
    maxSessionToken: config.claudeMaxSessionToken,
    maxCookies: config.claudeMaxCookies,
  };
}

function forwardToAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
  proxyConfig: ProxyConfig,
): void {
  const isMax = proxyConfig.mode === 'max';

  const targetHost = isMax ? CLAUDE_MAX_HOST : ANTHROPIC_API_HOST;
  const targetPath = req.url || '/v1/messages';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version':
      (req.headers['anthropic-version'] as string) || '2023-06-01',
  };

  if (isMax) {
    // Claude Max mode: use session token
    headers['cookie'] =
      proxyConfig.maxCookies ||
      `sessionKey=${proxyConfig.maxSessionToken}`;
  } else {
    // API key mode: inject the real key
    headers['x-api-key'] = proxyConfig.apiKey;
  }

  const options: https.RequestOptions = {
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: req.method || 'POST',
    headers,
  };

  const upstream = https.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'upstream_error', message: err.message }),
    );
  });

  upstream.write(body);
  upstream.end();
}

export function createLlmProxy(): http.Server {
  const proxyConfig = getProxyConfig();

  const server = http.createServer((req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: proxyConfig.mode }));
      return;
    }

    // Only allow POST to /v1/*
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    // Auth check: containers must send some auth header
    // (the proxy replaces it with the real key)
    const hasAuth = req.headers['x-api-key'] || req.headers['authorization'];

    if (!hasAuth) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Missing auth header',
        }),
      );
      return;
    }

    // Collect body
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      forwardToAnthropic(req, res, body, proxyConfig);
    });
    req.on('error', () => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_request' }));
    });
  });

  return server;
}

export function startLlmProxy(): http.Server {
  const server = createLlmProxy();
  const port = config.llmProxyPort;

  server.listen(port, '0.0.0.0', () => {
    console.log(`[llm-proxy] Listening on :${port} (mode=${config.llmMode})`);
  });

  return server;
}
