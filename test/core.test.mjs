import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runAll, runAudit, runDoctor, runHeal, runPremortem, runPremortemSession } from '../src/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'agoragentic-premortem-golden-loop.mjs');
const MCP_BIN = path.join(ROOT, 'bin', 'agoragentic-premortem-golden-loop-mcp.mjs');

describe('premortem golden loop core', () => {
  it('passes a release-ready local agent repo without network access', async () => {
    const repo = await makeFixture({
      readme: [
        '# Fixture Agent',
        '',
        'Install with npm install and run npm test.',
        'This agent uses Agent OS and execute(task,input,constraints) for external work.',
        'No-spend mode is the default. Paid execution requires owner approval, budget, max_cost, x402, and USDC funding.',
        'Each run writes a receipt, trace_id, invocation_id, audit trail, and reconciliation note.',
        'Health endpoint: /health. Rollback: redeploy the prior version.'
      ].join('\n'),
      agentJson: true,
      envExample: true
    });

    const report = await runPremortem({ repo });
    assert.equal(report.summary.blockers, 0, JSON.stringify(report.risks, null, 2));
    assert.equal(report.checks.find((check) => check.id === 'secret-hygiene-clear')?.status, 'pass');

    const run = await runAll({ repo, skipNetwork: true });
    assert.equal(run.receipt.no_spend, true);
    assert.equal(run.receipt.pass, true, JSON.stringify(run.golden_loop.stages, null, 2));
    assert.match(run.receipt.receipt_id, /^pgl_[a-f0-9]{16}$/);
  });

  it('flags secret-like values without echoing the secret', async () => {
    const repo = await makeFixture({
      readme: 'No-spend agent with budget docs, receipts, health checks, and Agent OS execute(task,input,constraints).',
      agentJson: true,
      envExample: true
    });
    const secret = ['amk', 'liveSecretValueShouldNotAppear'].join('_');
    await fs.writeFile(path.join(repo, '.env'), `AGORAGENTIC_API_KEY=${secret}\n`, 'utf8');

    const report = await runPremortem({ repo });
    const risk = report.risks.find((item) => item.id === 'secret-hygiene-failed');
    assert.equal(risk?.severity, 'blocker');
    assert.match(JSON.stringify(risk.evidence), /\.env:1/);
    assert.doesNotMatch(JSON.stringify(risk.evidence), new RegExp(secret));
  });

  it('writes JSON artifacts through the CLI', async () => {
    const repo = await makeFixture({
      readme: 'Agent OS no-spend agent with budget approval, receipt, reconciliation, health, and execute(task,input,constraints).',
      agentJson: true,
      envExample: true
    });
    const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-out-')), 'artifacts');
    const result = spawnSync(process.execPath, [BIN, 'run', '--repo', repo, '--out', out, '--skip-network', '--json'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.receipt.no_spend, true);
    assert.equal((await exists(path.join(out, 'premortem.json'))), true);
    assert.equal((await exists(path.join(out, 'golden-loop.json'))), true);
    assert.equal((await exists(path.join(out, 'local-receipt.json'))), true);
  });

  it('doctor explains the local safety boundary before an audit', async () => {
    const repo = await makeFixture({
      readme: 'Local no-spend Agent OS repository with receipts and owner approval.',
      agentJson: true,
      envExample: true
    });

    const doctor = await runDoctor({ repo });

    assert.equal(doctor.status, 'ready');
    assert.equal(doctor.boundary.data_sent_anywhere, false);
    assert.ok(doctor.never.includes('No deletes.'));
    assert.ok(doctor.recommended_commands.some((command) => command.includes('audit --repo .')));
  });

  it('serves local audit tools over MCP stdio', async () => {
    const repo = await makeFixture({
      readme: 'Local no-spend Agent OS repository with receipts and owner approval.',
      agentJson: true,
      envExample: true
    });
    const child = spawn(process.execPath, [MCP_BIN], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const state = { buffer: Buffer.alloc(0), responses: [], stderr: '' };
    child.stdout.on('data', (chunk) => readMcpResponses(state, chunk));
    child.stderr.on('data', (chunk) => {
      state.stderr += String(chunk);
    });

    try {
      sendMcp(child, 1, 'initialize', {});
      const init = await waitForMcp(state, 1);
      assert.equal(init.result.serverInfo.name, 'agoragentic-premortem-golden-loop');

      sendMcp(child, 2, 'tools/list', {});
      const list = await waitForMcp(state, 2);
      assert.ok(list.result.tools.some((tool) => tool.name === 'agoragentic_audit'));

      sendMcp(child, 3, 'tools/call', {
        name: 'agoragentic_doctor',
        arguments: { repo }
      });
      const call = await waitForMcp(state, 3);
      const parsed = JSON.parse(call.result.content[0].text);
      assert.equal(parsed.schema, 'agoragentic.premortem-golden-loop.doctor.v1');
      assert.equal(parsed.boundary.data_sent_anywhere, false);
    } finally {
      child.stdin.end();
      child.kill();
    }
  });

  it('audit writes an HTML guide and IDE handoff without changing repo files by default', async () => {
    const repo = await makeFixture({
      readme: 'Local OSS agent with install docs but missing discovery metadata and explicit safety workflows. Success: builders run it and fix release blockers.',
      agentJson: false,
      envExample: false,
      testScript: false
    });
    const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-audit-')), 'artifacts');
    const result = spawnSync(process.execPath, [
      BIN,
      'audit',
      '--repo',
      repo,
      '--out',
      out,
      '--plan',
      'Release a local-first OSS agent that audits Golden Loop readiness.',
      '--audience',
      'AI agent builders using local IDEs',
      '--success',
      'builders produce a receipt and fix one blocker before release',
      '--json'
    ], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema, 'agoragentic.premortem-golden-loop.audit.v1');
    assert.equal(parsed.boundary.self_heal_deletes_files, false);
    assert.equal((await exists(path.join(out, 'audit-guide.html'))), true);
    assert.equal((await exists(path.join(out, 'audit-summary.md'))), true);
    assert.equal((await exists(path.join(out, 'ide-fix-prompt.md'))), true);
    assert.equal((await exists(path.join(out, 'agent-handoff.md'))), true);
    assert.equal((await exists(path.join(repo, 'agent.json'))), false);
    assert.equal((await exists(path.join(repo, 'docs', 'AGORAGENTIC_SAFETY_BOUNDARIES.md'))), false);
  });

  it('audit can apply only safe additive scaffolds after explicit approval', async () => {
    const repo = await makeFixture({
      readme: 'Local OSS agent with install docs but missing discovery metadata and explicit safety workflows. Success: owners get a clean receipt.',
      agentJson: false,
      envExample: false,
      testScript: false
    });

    const audit = await runAudit({
      repo,
      applySafeFixes: true,
      plan: 'Release a local no-spend agent readiness checker.',
      audience: 'open-source AI agent builders',
      success: 'owners fix Golden Loop blockers before launch'
    });

    assert.equal(audit.healing.mode, 'apply_safe_fixes');
    assert.equal(audit.boundary.self_heal_deletes_files, false);
    assert.ok(audit.healing.applied.some((item) => item.target === 'agent.json' && item.status === 'created'));
    assert.equal((await exists(path.join(repo, 'agent.json'))), true);
    assert.equal((await exists(path.join(repo, 'docs', 'AGORAGENTIC_WORKFLOWS.md'))), true);
  });

  it('generates a prompt-style premortem session with investigator findings', async () => {
    const repo = await makeFixture({
      readme: 'Premortem agent repo for Agent OS builders. Success: ten target users run it and revise a release plan.',
      agentJson: true,
      envExample: true
    });

    const session = await runPremortemSession({
      repo,
      plan: 'Release an OSS Agoragentic premortem agent on GitHub that tests Golden Loop readiness for installable AI agent repositories.',
      audience: 'AI agent builders and small teams preparing public agent releases',
      success: 'at least ten real target users install it, run a premortem, and make one concrete launch change'
    });

    assert.equal(session.status, 'complete');
    assert.ok(session.failure_reasons.length >= 5);
    assert.equal(session.deep_dives.length, session.failure_reasons.length);
    assert.match(session.synthesis.hidden_assumption, /hidden assumption/i);
  });

  it('writes HTML report and transcript through the session CLI', async () => {
    const repo = await makeFixture({
      readme: 'Agent OS launch helper. Goal: users produce premortem reports before public release.',
      agentJson: true,
      envExample: true
    });
    const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-session-')), 'artifacts');
    const result = spawnSync(process.execPath, [
      BIN,
      'session',
      '--repo',
      repo,
      '--out',
      out,
      '--plan',
      'Launch a GitHub repo for an AI agent that runs premortems and no-spend Golden Loop checks.',
      '--audience',
      'open-source AI agent builders',
      '--success',
      'builders run the agent and revise their launch plan before release'
    ], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Premortem report written/);
    const files = await fs.readdir(out);
    assert.ok(files.some((file) => /^premortem-report-.*\.html$/.test(file)));
    assert.ok(files.some((file) => /^premortem-transcript-.*\.md$/.test(file)));
  });

  it('plans self-healing without changing files', async () => {
    const repo = await makeFixture({
      readme: 'Local OSS agent with install docs but missing discovery metadata and explicit safety workflows.',
      agentJson: false,
      envExample: false,
      testScript: false
    });

    const report = await runHeal({ repo });

    assert.equal(report.mode, 'plan_only');
    assert.equal(report.free_to_use, true);
    assert.equal(report.privacy.data_sent_anywhere, false);
    assert.ok(report.plan.actions.some((action) => action.id === 'safety-boundaries-doc' && action.type === 'create_file'));
    assert.ok(report.plan.actions.some((action) => action.id === 'agent-descriptor' && action.type === 'create_file'));
    assert.equal(await exists(path.join(repo, 'docs', 'AGORAGENTIC_SAFETY_BOUNDARIES.md')), false);
    assert.equal(await exists(path.join(repo, 'agent.json')), false);
  });

  it('applies only additive self-healing scaffolds', async () => {
    const repo = await makeFixture({
      readme: 'Local OSS agent with install docs but missing discovery metadata and explicit safety workflows.',
      agentJson: false,
      envExample: false,
      testScript: false
    });

    const report = await runHeal({ repo, applySafeFixes: true });

    assert.equal(report.mode, 'apply_safe_fixes');
    assert.ok(report.applied.some((item) => item.target === 'docs/AGORAGENTIC_SAFETY_BOUNDARIES.md' && item.status === 'created'));
    assert.ok(report.applied.some((item) => item.target === 'agent.json' && item.status === 'created'));
    assert.ok(report.after);
    assert.equal(await exists(path.join(repo, 'docs', 'AGORAGENTIC_GOALS.md')), true);
    assert.equal(await exists(path.join(repo, 'docs', 'AGORAGENTIC_WORKFLOWS.md')), true);
    assert.equal(await exists(path.join(repo, 'docs', 'AGORAGENTIC_SAFETY_BOUNDARIES.md')), true);
    assert.equal(await exists(path.join(repo, '.env.example')), true);
    assert.equal(await exists(path.join(repo, '.github', 'workflows', 'agoragentic-premortem-golden-loop.yml')), true);
  });

  it('writes self-heal artifacts through the CLI', async () => {
    const repo = await makeFixture({
      readme: 'Local OSS agent with install docs but missing discovery metadata and explicit safety workflows.',
      agentJson: false,
      envExample: false,
      testScript: false
    });
    const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-heal-')), 'artifacts');
    const result = spawnSync(process.execPath, [BIN, 'heal', '--repo', repo, '--out', out, '--apply-safe-fixes', '--json'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schema, 'agoragentic.premortem-golden-loop.heal.v1');
    assert.equal(parsed.boundary.network_calls, false);
    assert.equal((await exists(path.join(out, 'healing-plan.json'))), true);
    assert.equal((await exists(path.join(out, 'healing-plan.md'))), true);
    assert.equal((await exists(path.join(repo, 'docs', 'AGORAGENTIC_SAFETY_BOUNDARIES.md'))), true);
  });

  it('does not create a missing repository root when safe fixes are requested', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-missing-'));
    const missing = path.join(parent, 'missing-repo');

    const report = await runHeal({ repo: missing, applySafeFixes: true });

    assert.equal(await exists(missing), false);
    assert.ok(report.applied.length > 0);
    assert.ok(report.applied.every((item) => item.status === 'blocked'));
  });

  it('ships integration templates for common local agents', async () => {
    const required = [
      'docs/INTEGRATIONS.md',
      'Dockerfile',
      'docker-compose.yml',
      'templates/github-actions/agoragentic-premortem-golden-loop.yml',
      'templates/mcp/claude-desktop.json',
      'templates/cursor/agoragentic-premortem-golden-loop.mdc',
      'templates/claude/CLAUDE.md',
      'templates/codex/AGENTS.md',
      'templates/cline/.clinerules',
      'templates/windsurf/.windsurfrules',
      'templates/antigravity/GEMINI.md',
      'templates/systemd/agoragentic-premortem-golden-loop.service',
      'templates/systemd/agoragentic-premortem-golden-loop.timer'
    ];

    for (const rel of required) {
      assert.equal(await exists(path.join(ROOT, ...rel.split('/'))), true, rel);
    }
  });
});

async function makeFixture({ readme, agentJson, envExample, testScript = true }) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-repo-'));
  await fs.writeFile(path.join(repo, 'README.md'), `${readme}\n`, 'utf8');
  await fs.writeFile(path.join(repo, 'LICENSE'), 'MIT License\n', 'utf8');
  const packageJson = {
    name: 'fixture-agent',
    version: '1.0.0',
    type: 'module'
  };
  if (testScript) {
    packageJson.scripts = {
      test: 'node --test'
    };
  }
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
    ...packageJson
  }, null, 2), 'utf8');
  if (agentJson) {
    await fs.writeFile(path.join(repo, 'agent.json'), JSON.stringify({
      name: 'fixture-agent',
      description: 'Fixture installable agent',
      no_spend_default: true
    }, null, 2), 'utf8');
  }
  if (envExample) {
    await fs.writeFile(path.join(repo, '.env.example'), 'AGORAGENTIC_API_KEY=amk_your_key\nMAX_COST_USDC=0\n', 'utf8');
  }
  return repo;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sendMcp(child, id, method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function readMcpResponses(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  while (true) {
    const headerEnd = state.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = state.buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      state.buffer = state.buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (state.buffer.length < bodyEnd) return;
    const body = state.buffer.slice(bodyStart, bodyEnd).toString('utf8');
    state.buffer = state.buffer.slice(bodyEnd);
    state.responses.push(JSON.parse(body));
  }
}

function waitForMcp(state, id) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const index = state.responses.findIndex((response) => response.id === id);
      if (index !== -1) {
        clearInterval(timer);
        resolve(state.responses.splice(index, 1)[0]);
        return;
      }
      if (Date.now() - started > 4000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for MCP response ${id}. stderr: ${state.stderr}`));
      }
    }, 10);
  });
}
