import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runAll, runAudit, runDoctor, runHeal, runPremortem, runPremortemSession } from '../src/core.mjs';
import { createExternalAgentServer } from '../src/http-server.mjs';

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

  it('serves an opt-in external HTTP agent with auth and remote-action gates', async () => {
    const repo = await makeFixture({
      readme: 'Local no-spend Agent OS repository with receipts and owner approval.',
      agentJson: true,
      envExample: true
    });
    const server = createExternalAgentServer({ repo, token: 'test-token' });
    await listenHttp(server);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      const healthJson = await health.json();
      assert.equal(healthJson.token_required, true);
      assert.equal(healthJson.boundary.paid_execution, false);

      const unauthorized = await fetch(`${baseUrl}/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(unauthorized.status, 401);

      const forbidden = await fetch(`${baseUrl}/audit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ applySafeFixes: true })
      });
      assert.equal(forbidden.status, 403);

      const audit = await fetch(`${baseUrl}/audit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          plan: 'Release a local external agent wrapper.',
          audience: 'AI agent builders',
          success: 'builders run the external audit and keep the receipt'
        })
      });
      assert.equal(audit.status, 200);
      const parsed = await audit.json();
      assert.equal(parsed.schema, 'agoragentic.premortem-golden-loop.audit.v1');
      assert.equal(parsed.boundary.paid_execution, false);
      assert.equal(parsed.artifacts.closure_loop.endsWith('closure-loop.json'), true);
      assert.equal(await exists(parsed.artifacts.closure_loop), true);
    } finally {
      await closeHttp(server);
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
    assert.ok(parsed.launch_gate.source_files_read.count >= 1);
    assert.ok(parsed.launch_gate.source_files_read.files.includes('README.md'));
    assert.ok(parsed.launch_gate.assumptions_refused.some((item) => /Did not invent private team politics/.test(item)));
    assert.ok(parsed.launch_gate.risky_actions_blocked.includes('Deploy or publish'));
    assert.match(parsed.launch_gate.ide_prompt_handed_off.exact_prompt, /# Agoragentic Handoff For local IDE agent/);
    assert.equal(parsed.closure_loop.previous_audit_found, false);
    assert.ok(parsed.closure_loop.summary.still_open >= 1);
    assert.equal((await exists(path.join(out, 'audit-guide.html'))), true);
    assert.equal((await exists(path.join(out, 'audit-summary.md'))), true);
    assert.equal((await exists(path.join(out, 'closure-loop.json'))), true);
    assert.equal((await exists(path.join(out, 'closure-loop.md'))), true);
    assert.equal((await exists(path.join(out, 'ide-fix-prompt.md'))), true);
    assert.equal((await exists(path.join(out, 'agent-handoff.md'))), true);
    const guideHtml = await fs.readFile(path.join(out, 'audit-guide.html'), 'utf8');
    assert.match(guideHtml, /Launch Gate/);
    assert.match(guideHtml, /Closure Loop/);
    assert.match(guideHtml, /Recommendation Closure Ledger/);
    assert.match(guideHtml, /Source Files Read/);
    assert.match(guideHtml, /Assumptions Refused/);
    assert.match(guideHtml, /Risky Action Blocked/);
    assert.match(guideHtml, /Exact IDE Prompt Handed Off/);
    assert.match(guideHtml, /# Agoragentic Handoff For local IDE agent/);
    assert.equal((await exists(path.join(repo, 'agent.json'))), false);
    assert.equal((await exists(path.join(repo, 'docs', 'AGORAGENTIC_SAFETY_BOUNDARIES.md'))), false);
  });

  it('tracks whether recommended fixes were applied on later audit runs', async () => {
    const repo = await makeFixture({
      readme: 'Local OSS agent with install docs but missing discovery metadata and explicit safety workflows. Success: owners close the loop.',
      agentJson: false,
      envExample: false,
      testScript: false
    });
    const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pgl-closure-')), 'artifacts');
    const baseArgs = [
      'audit',
      '--repo',
      repo,
      '--out',
      out,
      '--plan',
      'Release a local-first OSS agent readiness checker.',
      '--audience',
      'open-source AI agent builders',
      '--success',
      'owners fix Golden Loop blockers before launch',
      '--json'
    ];

    const first = spawnSync(process.execPath, [BIN, ...baseArgs], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.equal(first.status, 0, first.stderr);

    const second = spawnSync(process.execPath, [BIN, ...baseArgs, '--apply-safe-fixes'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.equal(second.status, 0, second.stderr);
    const parsed = JSON.parse(second.stdout);
    assert.equal(parsed.closure_loop.previous_audit_found, true);
    assert.ok(parsed.closure_loop.summary.applied_this_run >= 1);
    assert.ok(parsed.closure_loop.items.some((item) => item.target === 'agent.json' && item.status === 'applied_this_run'));

    const closure = JSON.parse(await fs.readFile(path.join(out, 'closure-loop.json'), 'utf8'));
    assert.equal(closure.previous_audit_found, true);
    assert.ok(closure.items.some((item) => item.target === 'agent.json' && item.status === 'applied_this_run'));
    const closureMd = await fs.readFile(path.join(out, 'closure-loop.md'), 'utf8');
    assert.match(closureMd, /Fix Closure Table/);
    assert.match(closureMd, /applied_this_run/);
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
      'docs/EXTERNAL_AGENT.md',
      'docs/RELEASE.md',
      'examples/sample-audit-summary.md',
      'examples/sample-closure-loop.md',
      'examples/sample-ide-fix-prompt.md',
      'examples/sample-local-receipt.json',
      'Dockerfile',
      'docker-compose.yml',
      'bin/agoragentic-premortem-golden-loop-server.mjs',
      'src/http-server.mjs',
      'scripts/generate-brand-assets.mjs',
      'assets/social-card.svg',
      'assets/readme-hero.svg',
      'assets/workflow-diagram.svg',
      'assets/icon.svg',
      'templates/github-actions/agoragentic-premortem-golden-loop.yml',
      'templates/external-agent/audit-request.json',
      'templates/mcp/claude-desktop.json',
      'templates/cursor/agoragentic-premortem-golden-loop.mdc',
      'templates/claude/CLAUDE.md',
      'templates/codex/AGENTS.md',
      'templates/cline/.clinerules',
      'templates/windsurf/.windsurfrules',
      'templates/antigravity/GEMINI.md',
      'templates/systemd/agoragentic-premortem-golden-loop.service',
      'templates/systemd/agoragentic-premortem-golden-loop-server.service',
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

function listenHttp(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeHttp(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
