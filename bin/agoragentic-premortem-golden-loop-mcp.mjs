#!/usr/bin/env node
import path from 'node:path';
import {
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT_DIR,
  runAudit,
  runDoctor,
  runGoldenLoop,
  runHeal,
  runPremortem,
  runPremortemSession,
  writeAuditArtifacts
} from '../src/core.mjs';

const SERVER_INFO = {
  name: 'agoragentic-premortem-golden-loop',
  version: '0.1.5'
};

const TOOLS = [
  {
    name: 'agoragentic_doctor',
    description: 'Explain the local no-spend audit boundary before running a repo audit.',
    inputSchema: repoSchema()
  },
  {
    name: 'agoragentic_audit',
    description: 'Run the local premortem, no-spend Golden Loop, self-heal plan, HTML guide, and IDE handoff.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoSchema().properties,
        plan: { type: 'string', description: 'Plan, launch, product, strategy, or decision to premortem.' },
        audience: { type: 'string', description: 'Who the plan is for or affects.' },
        success: { type: 'string', description: 'What a win looks like.' },
        targetUrl: { type: 'string', description: 'Optional local running agent URL to probe.' },
        allowNetworkCanaries: { type: 'boolean', description: 'Opt in to public no-spend Agoragentic canaries. Sends no repo contents.' },
        runTests: { type: 'boolean', description: 'Run package.json scripts.test with no-spend environment variables.' },
        applySafeFixes: { type: 'boolean', description: 'Create only missing additive scaffolds after owner approval.' },
        writeArtifacts: { type: 'boolean', description: 'Write local audit artifacts. Defaults to true.' }
      }
    }
  },
  {
    name: 'agoragentic_heal',
    description: 'Build a self-heal plan, optionally creating only missing additive scaffolds.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoSchema().properties,
        applySafeFixes: { type: 'boolean', description: 'Create only missing additive scaffolds after owner approval.' }
      }
    }
  },
  {
    name: 'agoragentic_premortem',
    description: 'Run the deterministic local repo release premortem.',
    inputSchema: repoSchema()
  },
  {
    name: 'agoragentic_golden_loop',
    description: 'Run the local no-spend Golden Loop readiness check.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoSchema().properties,
        targetUrl: { type: 'string', description: 'Optional local running agent URL to probe.' },
        allowNetworkCanaries: { type: 'boolean', description: 'Opt in to public no-spend Agoragentic canaries. Sends no repo contents.' },
        runTests: { type: 'boolean', description: 'Run package.json scripts.test with no-spend environment variables.' }
      }
    }
  },
  {
    name: 'agoragentic_premortem_session',
    description: 'Run the Klein-style plan premortem when plan, audience, and success context are available.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoSchema().properties,
        plan: { type: 'string', description: 'Plan, launch, product, strategy, or decision to premortem.' },
        audience: { type: 'string', description: 'Who the plan is for or affects.' },
        success: { type: 'string', description: 'What a win looks like.' }
      }
    }
  }
];

let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void drainMessages();
});

process.stdin.on('end', () => {
  process.exit(0);
});

async function drainMessages() {
  while (true) {
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const header = inputBuffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (inputBuffer.length < bodyEnd) return;

    const body = inputBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    inputBuffer = inputBuffer.slice(bodyEnd);

    let message;
    try {
      message = JSON.parse(body);
    } catch (err) {
      sendError(null, -32700, `Parse error: ${err.message}`);
      continue;
    }

    void handleMessage(message);
  }
}

async function handleMessage(message) {
  if (!message || message.id === undefined) return;

  try {
    if (message.method === 'initialize') {
      sendResult(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
      return;
    }

    if (message.method === 'tools/list') {
      sendResult(message.id, { tools: TOOLS });
      return;
    }

    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      sendResult(message.id, result);
      return;
    }

    sendError(message.id, -32601, `Method not found: ${message.method}`);
  } catch (err) {
    sendError(message.id, -32603, err.message || String(err));
  }
}

async function callTool(name, args) {
  const options = normalizeOptions(args);
  let value;

  if (name === 'agoragentic_doctor') {
    value = await runDoctor(options);
  } else if (name === 'agoragentic_audit') {
    value = await runAudit(options);
    if (args.writeArtifacts !== false) {
      value.artifacts = await writeAuditArtifacts(resolveOutDir(args, options.repo), value);
    }
  } else if (name === 'agoragentic_heal') {
    value = await runHeal(options);
  } else if (name === 'agoragentic_premortem') {
    value = await runPremortem(options);
  } else if (name === 'agoragentic_golden_loop') {
    value = await runGoldenLoop(options);
  } else if (name === 'agoragentic_premortem_session') {
    value = await runPremortemSession(options);
  } else {
    throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function normalizeOptions(args) {
  const repo = path.resolve(String(args.repo || '.'));
  return {
    repo,
    baseUrl: String(args.baseUrl || DEFAULT_BASE_URL),
    targetUrl: args.targetUrl ? String(args.targetUrl) : null,
    plan: args.plan ? String(args.plan) : null,
    audience: args.audience ? String(args.audience) : null,
    success: args.success ? String(args.success) : null,
    skipNetwork: Boolean(args.skipNetwork),
    allowNetworkCanaries: Boolean(args.allowNetworkCanaries),
    applySafeFixes: Boolean(args.applySafeFixes),
    runTests: Boolean(args.runTests)
  };
}

function resolveOutDir(args, repo) {
  return path.resolve(args.out ? String(args.out) : path.join(repo, DEFAULT_OUTPUT_DIR));
}

function repoSchema() {
  return {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository path to inspect. Defaults to current working directory.'
      },
      out: {
        type: 'string',
        description: 'Output directory for local artifacts. Defaults to .agoragentic/premortem-golden-loop.'
      }
    }
  };
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
