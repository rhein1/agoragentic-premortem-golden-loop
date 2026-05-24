#!/usr/bin/env node
import path from 'node:path';
import {
  DEFAULT_EXTERNAL_AGENT_HOST,
  DEFAULT_EXTERNAL_AGENT_PORT,
  startHttpServer
} from '../src/http-server.mjs';

const USAGE = `
Agoragentic Premortem Golden Loop External HTTP Agent

Usage:
  agoragentic-premortem-golden-loop-server [options]

Options:
  --repo <path>                  Allowed repository root. Defaults to current directory.
  --host <host>                  Host to bind. Defaults to ${DEFAULT_EXTERNAL_AGENT_HOST}.
  --port <port>                  Port to bind. Defaults to ${DEFAULT_EXTERNAL_AGENT_PORT}.
  --external-agent-token <text>  Bearer token. Required for non-loopback host binding.
  --allow-remote-safe-fixes      Let authenticated callers request --apply-safe-fixes.
  --allow-remote-network         Let authenticated callers request target-url or no-spend network canaries.
  --allow-remote-tests           Let authenticated callers run package.json scripts.test.
  --help                         Show this help.
`;

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE.trimStart());
    return;
  }

  const server = await startHttpServer({
    repo: path.resolve(parsed.repo || '.'),
    host: parsed.host,
    port: parsed.port,
    ['token']: parsed.bearer,
    allowRemoteSafeFixes: parsed.allowRemoteSafeFixes,
    allowRemoteNetwork: parsed.allowRemoteNetwork,
    allowRemoteTests: parsed.allowRemoteTests
  });

  process.stdout.write([
    `External agent HTTP server listening on ${server.url}`,
    `Allowed root: ${server.allowed_root}`,
    `Bearer token required: ${server.token_required ? 'yes' : 'no'}`,
    'Default boundary: local-only repo audit, no outbound network, no paid execution, no deletes, no overwrites.'
  ].join('\n'));
  process.stdout.write('\n');
}

function parseArgs(argv) {
  const parsed = {
    repo: null,
    host: DEFAULT_EXTERNAL_AGENT_HOST,
    port: DEFAULT_EXTERNAL_AGENT_PORT,
    bearer: process.env.AGORAGENTIC_EXTERNAL_AGENT_TOKEN || '',
    allowRemoteSafeFixes: false,
    allowRemoteNetwork: false,
    allowRemoteTests: false,
    help: false
  };

  const args = [...argv];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--repo') parsed.repo = takeValue(args, ++index, arg);
    else if (arg === '--host') parsed.host = takeValue(args, ++index, arg);
    else if (arg === '--port') parsed.port = Number(takeValue(args, ++index, arg));
    else if (arg === '--external-agent-token') parsed.bearer = takeValue(args, ++index, arg);
    else if (arg === '--allow-remote-safe-fixes') parsed.allowRemoteSafeFixes = true;
    else if (arg === '--allow-remote-network') parsed.allowRemoteNetwork = true;
    else if (arg === '--allow-remote-tests') parsed.allowRemoteTests = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(parsed.port) || parsed.port < 0 || parsed.port > 65535) {
    throw new Error('--port must be an integer from 0 to 65535');
  }
  return parsed;
}

function takeValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err.message || err}\n`);
  process.exitCode = 1;
});
