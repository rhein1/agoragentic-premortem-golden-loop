import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT_DIR,
  runAll,
  runAudit,
  runDoctor,
  runGoldenLoop,
  runHeal,
  runPremortem,
  runPremortemSession,
  writeAuditArtifacts
} from './core.mjs';

export const DEFAULT_EXTERNAL_AGENT_HOST = '127.0.0.1';
export const DEFAULT_EXTERNAL_AGENT_PORT = 8787;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_LIMIT_BYTES = 1_000_000;

const HTTP_TOOLS = [
  {
    name: 'doctor',
    method: 'POST',
    path: '/doctor',
    description: 'Explain the local no-spend safety boundary for the configured repository.'
  },
  {
    name: 'audit',
    method: 'POST',
    path: '/audit',
    description: 'Run the local premortem, no-spend Golden Loop, closure loop, self-heal plan, HTML guide, and IDE handoff.'
  },
  {
    name: 'heal',
    method: 'POST',
    path: '/heal',
    description: 'Build a self-heal plan. Safe file creation requires the server to be started with --allow-remote-safe-fixes.'
  },
  {
    name: 'premortem',
    method: 'POST',
    path: '/premortem',
    description: 'Run the deterministic local repo release premortem.'
  },
  {
    name: 'golden-loop',
    method: 'POST',
    path: '/golden-loop',
    description: 'Run the local no-spend Golden Loop readiness check.'
  },
  {
    name: 'session',
    method: 'POST',
    path: '/session',
    description: 'Run the Klein-style plan premortem when plan, audience, and success context are available.'
  },
  {
    name: 'run',
    method: 'POST',
    path: '/run',
    description: 'Run the local premortem plus no-spend Golden Loop receipt.'
  }
];

export function createExternalAgentServer(config = {}) {
  const allowedRoot = path.resolve(config.repo || '.');
  const token = String(config.token || process.env.AGORAGENTIC_EXTERNAL_AGENT_TOKEN || '');
  const serverConfig = {
    allowedRoot,
    token,
    baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    allowRemoteSafeFixes: Boolean(config.allowRemoteSafeFixes),
    allowRemoteNetwork: Boolean(config.allowRemoteNetwork),
    allowRemoteTests: Boolean(config.allowRemoteTests)
  };

  return http.createServer(async (request, response) => {
    try {
      await routeRequest(request, response, serverConfig);
    } catch (err) {
      const status = err.status || 500;
      sendJson(response, status, {
        error: status >= 500 ? 'internal_error' : 'request_error',
        message: err.message || String(err)
      });
    }
  });
}

export async function startHttpServer(options = {}) {
  const host = String(options.host ?? process.env.AGORAGENTIC_EXTERNAL_AGENT_HOST ?? DEFAULT_EXTERNAL_AGENT_HOST);
  const port = Number(options.port ?? process.env.AGORAGENTIC_EXTERNAL_AGENT_PORT ?? DEFAULT_EXTERNAL_AGENT_PORT);
  const token = String(options.token ?? process.env.AGORAGENTIC_EXTERNAL_AGENT_TOKEN ?? '');

  if (!isLoopbackHost(host) && !token) {
    throw new Error('Refusing to bind the external agent server to a non-loopback host without AGORAGENTIC_EXTERNAL_AGENT_TOKEN or --external-agent-token.');
  }

  const server = createExternalAgentServer({ ...options, host, port, token });
  await listen(server, port, host);
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${formatHost(host)}:${actualPort}`;
  return {
    server,
    host,
    port: actualPort,
    url,
    token_required: Boolean(token),
    allowed_root: path.resolve(options.repo || '.')
  };
}

async function routeRequest(request, response, config) {
  const url = new URL(request.url || '/', 'http://localhost');
  const pathname = normalizePath(url.pathname);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      allow: 'GET,POST,OPTIONS',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization'
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, {
      schema: 'agoragentic.premortem-golden-loop.external-agent.health.v1',
      status: 'ok',
      tools_path: '/tools',
      agent_descriptor_path: '/.well-known/agent.json',
      token_required: Boolean(config.token),
      boundary: externalBoundary(config)
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/.well-known/agent.json') {
    sendJson(response, 200, await loadAgentDescriptor(config));
    return;
  }

  if (request.method === 'GET' && pathname === '/tools') {
    requireAuth(request, config);
    sendJson(response, 200, {
      schema: 'agoragentic.premortem-golden-loop.external-agent.tools.v1',
      tools: HTTP_TOOLS,
      boundary: externalBoundary(config)
    });
    return;
  }

  if (request.method !== 'POST') {
    throw new HttpError(404, `No route for ${request.method} ${pathname}`);
  }

  requireAuth(request, config);
  const body = await readJsonBody(request);

  if (pathname === '/doctor') {
    sendJson(response, 200, await runDoctor(requestOptions(body, config)));
    return;
  }

  if (pathname === '/audit') {
    const options = requestOptions(body, config);
    const audit = await runAudit(options);
    if (body.writeArtifacts !== false) {
      audit.artifacts = await writeAuditArtifacts(resolveOutDir(body, options.repo), audit);
    }
    sendJson(response, 200, audit);
    return;
  }

  if (pathname === '/heal') {
    sendJson(response, 200, await runHeal(requestOptions(body, config)));
    return;
  }

  if (pathname === '/premortem') {
    sendJson(response, 200, await runPremortem(requestOptions(body, config)));
    return;
  }

  if (pathname === '/golden-loop') {
    sendJson(response, 200, await runGoldenLoop(requestOptions(body, config)));
    return;
  }

  if (pathname === '/session') {
    sendJson(response, 200, await runPremortemSession(requestOptions(body, config)));
    return;
  }

  if (pathname === '/run') {
    sendJson(response, 200, await runAll(requestOptions(body, config)));
    return;
  }

  throw new HttpError(404, `No route for ${request.method} ${pathname}`);
}

function requestOptions(body, config) {
  const repo = resolveRepo(body.repo, config.allowedRoot);
  if (body.applySafeFixes && !config.allowRemoteSafeFixes) {
    throw new HttpError(403, 'Remote safe fixes are disabled. Restart the server with --allow-remote-safe-fixes after owner approval.');
  }
  if (body.runTests && !config.allowRemoteTests) {
    throw new HttpError(403, 'Remote test execution is disabled. Restart the server with --allow-remote-tests after owner approval.');
  }
  if ((body.allowNetworkCanaries || body.targetUrl) && !config.allowRemoteNetwork) {
    throw new HttpError(403, 'Remote network probes are disabled. Restart the server with --allow-remote-network after owner approval.');
  }

  const requestedNetwork = Boolean(body.allowNetworkCanaries || body.targetUrl);
  return {
    repo,
    baseUrl: String(body.baseUrl || config.baseUrl || DEFAULT_BASE_URL),
    targetUrl: body.targetUrl ? String(body.targetUrl) : null,
    plan: body.plan ? String(body.plan) : null,
    planFile: body.planFile ? String(body.planFile) : null,
    audience: body.audience ? String(body.audience) : null,
    success: body.success ? String(body.success) : null,
    skipNetwork: requestedNetwork ? Boolean(body.skipNetwork) : true,
    allowNetworkCanaries: Boolean(body.allowNetworkCanaries),
    applySafeFixes: Boolean(body.applySafeFixes),
    runTests: Boolean(body.runTests)
  };
}

function resolveRepo(repo, allowedRoot) {
  const requested = repo
    ? path.resolve(allowedRoot, String(repo))
    : allowedRoot;
  if (!isInsideOrSame(allowedRoot, requested)) {
    throw new HttpError(403, 'Requested repo must stay inside the server allowed root.');
  }
  return requested;
}

function resolveOutDir(body, repo) {
  const outDir = path.resolve(body.out ? String(body.out) : path.join(repo, DEFAULT_OUTPUT_DIR));
  if (!isInsideOrSame(repo, outDir)) {
    throw new HttpError(403, 'Output directory must stay inside the selected repository.');
  }
  return outDir;
}

async function loadAgentDescriptor(config) {
  const descriptorPath = path.join(PACKAGE_ROOT, 'agent.json');
  let descriptor = {};
  try {
    descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  } catch {
    descriptor = {
      schema: 'agoragentic.agent-descriptor.v1',
      name: 'Agoragentic Premortem Golden Loop Agent'
    };
  }
  return {
    ...descriptor,
    external_http_agent: {
      schema: 'agoragentic.external-http-agent.v1',
      health: '/health',
      tools: '/tools',
      endpoints: HTTP_TOOLS.map((tool) => ({ method: tool.method, path: tool.path, name: tool.name })),
      token_required: Boolean(config.token),
      allowed_root: config.allowedRoot,
      boundary: externalBoundary(config)
    }
  };
}

function externalBoundary(config) {
  return {
    local_first: true,
    outbound_network_default: false,
    repo_contents_uploaded_by_default: false,
    paid_execution: false,
    production_mutation: false,
    deletes_files: false,
    overwrites_files: false,
    source_rewrites: false,
    remote_safe_fixes_enabled: Boolean(config.allowRemoteSafeFixes),
    remote_network_enabled: Boolean(config.allowRemoteNetwork),
    remote_tests_enabled: Boolean(config.allowRemoteTests)
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) throw new HttpError(413, 'JSON request body is too large.');
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new HttpError(400, `Invalid JSON body: ${err.message}`);
  }
}

function requireAuth(request, config) {
  if (!config.token) return;
  const value = request.headers.authorization || '';
  const expected = `Bearer ${config.token}`;
  if (!timingSafeEqual(value, expected)) {
    throw new HttpError(401, 'Missing or invalid bearer token.');
  }
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(`${body}\n`);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function normalizePath(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized.startsWith('/v1/') ? normalized.slice(3) : normalized;
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function formatHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function isInsideOrSame(root, target) {
  const relativePath = path.relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
