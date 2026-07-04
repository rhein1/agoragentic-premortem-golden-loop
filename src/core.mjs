import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://agoragentic.com';
export const DEFAULT_OUTPUT_DIR = '.agoragentic/premortem-golden-loop';

const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.env',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml'
]);

const IGNORED_DIRS = new Set([
  '.agoragentic',
  '.cache',
  '.git',
  '.micro-ecf',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'venv'
]);

const SECRET_PATTERNS = [
  {
    id: 'private-key-block',
    label: 'private key block',
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i
  },
  {
    id: 'aws-access-key',
    label: 'AWS access key',
    regex: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    id: 'openai-style-key',
    label: 'OpenAI-style secret key',
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/
  },
  {
    id: 'agoragentic-api-key',
    label: 'Agoragentic API key',
    regex: /\bamk_[A-Za-z0-9_-]{12,}\b/
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    regex: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/
  },
  {
    id: 'env-secret-value',
    label: 'secret-like environment value',
    regex: /\b(?:API[_-]?KEY|SECRET|TOKEN|PRIVATE[_-]?KEY|PASSWORD)\s*[:=]\s*["']?(?!your|example|sample|changeme|placeholder|<|$)[A-Za-z0-9_./+=:@-]{12,}/i
  }
];

function nowIso() {
  return new Date().toISOString();
}

function slash(value) {
  return value.replace(/\\/g, '/');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeRoot(root = '.') {
  return path.resolve(root);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readText(filePath));
  } catch {
    return null;
  }
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function walkFiles(root, { maxFiles = 2500 } = {}) {
  const files = [];
  const queue = [root];

  while (queue.length && files.length < maxFiles) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(full);
        continue;
      }
      if (entry.isFile()) files.push(full);
      if (files.length >= maxFiles) break;
    }
  }

  return files;
}

function relative(root, filePath) {
  return slash(path.relative(root, filePath) || '.');
}

function fileBasenames(files) {
  return new Set(files.map((file) => path.basename(file).toLowerCase()));
}

function hasFile(files, names) {
  const basenames = fileBasenames(files);
  return names.some((name) => basenames.has(name.toLowerCase()));
}

function hasPath(files, root, candidates) {
  const rels = files.map((file) => relative(root, file).toLowerCase());
  return candidates.some((candidate) => {
    const normalized = slash(candidate).toLowerCase().replace(/\/$/, '');
    return rels.some((rel) => rel === normalized || rel.startsWith(`${normalized}/`));
  });
}

async function readSearchableText(root, files) {
  const candidates = files.filter((file) => {
    const rel = relative(root, file).toLowerCase();
    const ext = path.extname(file).toLowerCase();
    return TEXT_EXTENSIONS.has(ext)
      && !rel.includes('package-lock.json')
      && !rel.includes('pnpm-lock.yaml')
      && !rel.includes('yarn.lock');
  }).slice(0, 300);

  const chunks = [];
  for (const file of candidates) {
    const stat = await statSafe(file);
    if (!stat || stat.size > 250_000) continue;
    try {
      chunks.push(await readText(file));
    } catch {
      // Ignore unreadable files; the premortem will still report structural gaps.
    }
  }
  return chunks.join('\n').toLowerCase();
}

async function scanSecrets(root, files) {
  const findings = [];
  for (const file of files) {
    const rel = relative(root, file);
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (/package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/i.test(rel)) continue;

    const stat = await statSafe(file);
    if (!stat || stat.size > 350_000) continue;

    let text = '';
    try {
      text = await readText(file);
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lowered = line.toLowerCase();
      if (lowered.includes('placeholder') || lowered.includes('your_') || lowered.includes('example')) {
        continue;
      }
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            id: pattern.id,
            label: pattern.label,
            file: rel,
            line: index + 1
          });
          break;
        }
      }
      if (findings.length >= 25) return findings;
    }
  }
  return findings;
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function statusFromRisk(severity) {
  if (severity === 'blocker') return 'fail';
  if (severity === 'warning') return 'warn';
  return 'pass';
}

function addRisk(risks, checks, risk) {
  risks.push(risk);
  checks.push({
    id: risk.id,
    title: risk.title,
    status: statusFromRisk(risk.severity),
    evidence: risk.evidence,
    action: risk.action
  });
}

function addPass(checks, id, title, evidence) {
  checks.push({ id, title, status: 'pass', evidence });
}

function summarizeRisks(risks) {
  const blockers = risks.filter((risk) => risk.severity === 'blocker').length;
  const warnings = risks.filter((risk) => risk.severity === 'warning').length;
  const info = risks.filter((risk) => risk.severity === 'info').length;
  const score = Math.max(0, 100 - blockers * 22 - warnings * 8 - info * 2);
  return { score, blockers, warnings, info, risk_count: risks.length };
}

function nextActionsFromRisks(risks) {
  return risks
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 8)
    .map((risk) => ({
      risk_id: risk.id,
      severity: risk.severity,
      action: risk.action
    }));
}

function severityRank(severity) {
  return { blocker: 0, warning: 1, info: 2 }[severity] ?? 3;
}

function repoFingerprint(root, files) {
  const hash = crypto.createHash('sha256');
  hash.update(slash(root));
  for (const file of files.map((item) => relative(root, item)).sort()) {
    hash.update('\n');
    hash.update(file);
  }
  return hash.digest('hex').slice(0, 16);
}

export async function runPremortem(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const rootExists = await exists(root);
  const generatedAt = nowIso();

  if (!rootExists) {
    const risks = [{
      id: 'repo-not-found',
      severity: 'blocker',
      title: 'Repository path does not exist',
      evidence: [root],
      action: 'Run the premortem from an existing agent repository or pass --repo <path>.'
    }];
    return {
      schema: 'agoragentic.premortem.v1',
      generated_at: generatedAt,
      root,
      summary: summarizeRisks(risks),
      risks,
      checks: risks.map((risk) => ({
        id: risk.id,
        title: risk.title,
        status: 'fail',
        evidence: risk.evidence,
        action: risk.action
      })),
      next_actions: nextActionsFromRisks(risks),
      no_spend: true,
      source_files_read: []
    };
  }

  const files = await walkFiles(root);
  const relFiles = files.map((file) => relative(root, file));
  const basenames = fileBasenames(files);
  const text = await readSearchableText(root, files);
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const pyproject = await exists(path.join(root, 'pyproject.toml'));
  const risks = [];
  const checks = [];

  if (hasFile(files, ['README.md', 'README.txt', 'readme.md'])) {
    addPass(checks, 'readme-present', 'README exists', ['README is present.']);
  } else {
    addRisk(risks, checks, {
      id: 'readme-missing',
      severity: 'blocker',
      title: 'No README found',
      evidence: ['Expected README.md or equivalent.'],
      action: 'Add a README with install, configuration, run, test, safety, and support instructions.'
    });
  }

  if (hasFile(files, ['LICENSE', 'LICENSE.md', 'COPYING'])) {
    addPass(checks, 'license-present', 'OSS license exists', ['License file is present.']);
  } else {
    addRisk(risks, checks, {
      id: 'license-missing',
      severity: 'blocker',
      title: 'OSS license is missing',
      evidence: ['Expected LICENSE, LICENSE.md, or COPYING.'],
      action: 'Add a clear OSS license before releasing the repository.'
    });
  }

  const installEvidence = [];
  if (packageJson) installEvidence.push('package.json');
  if (pyproject) installEvidence.push('pyproject.toml');
  if (basenames.has('requirements.txt')) installEvidence.push('requirements.txt');
  if (basenames.has('setup.py')) installEvidence.push('setup.py');
  if (basenames.has('dockerfile')) installEvidence.push('Dockerfile');
  if (installEvidence.length) {
    addPass(checks, 'install-contract-present', 'Install contract exists', installEvidence);
  } else {
    addRisk(risks, checks, {
      id: 'install-contract-missing',
      severity: 'blocker',
      title: 'Install contract is missing',
      evidence: ['No package.json, pyproject.toml, requirements.txt, setup.py, or Dockerfile found.'],
      action: 'Add one reproducible install path so a new owner or agent can set up the repo without guessing.'
    });
  }

  const testEvidence = [];
  if (packageJson?.scripts?.test) testEvidence.push('package.json scripts.test');
  if (hasPath(files, root, ['tests', 'test'])) testEvidence.push('tests/ or test/');
  if (hasPath(files, root, ['.github/workflows'])) testEvidence.push('.github/workflows');
  if (testEvidence.length) {
    addPass(checks, 'test-contract-present', 'Test contract exists', testEvidence);
  } else {
    addRisk(risks, checks, {
      id: 'test-contract-missing',
      severity: 'warning',
      title: 'No test contract found',
      evidence: ['No package test script, tests directory, or GitHub Actions workflow found.'],
      action: 'Add a no-spend smoke test that proves install, configuration, and one deterministic agent action.'
    });
  }

  const descriptorEvidence = relFiles.filter((file) => /(^|\/)(agent-card|agent|openapi|skill|mcp|manifest)\.(json|ya?ml|md)$/i.test(file));
  if (descriptorEvidence.length) {
    addPass(checks, 'agent-discovery-present', 'Agent discovery contract exists', descriptorEvidence.slice(0, 8));
  } else {
    addRisk(risks, checks, {
      id: 'agent-discovery-missing',
      severity: 'warning',
      title: 'Agent discovery contract is missing',
      evidence: ['Expected agent.json, agent-card.json, openapi.yaml/json, SKILL.md, MCP manifest, or equivalent.'],
      action: 'Add a small machine-readable agent descriptor with name, purpose, inputs, outputs, auth, and no-spend/paid boundaries.'
    });
  }

  const secretFindings = await scanSecrets(root, files);
  if (secretFindings.length) {
    addRisk(risks, checks, {
      id: 'secret-hygiene-failed',
      severity: 'blocker',
      title: 'Potential secrets are present in repository text',
      evidence: secretFindings.map((finding) => `${finding.file}:${finding.line} ${finding.label}`),
      action: 'Remove committed secrets, rotate exposed values, and replace them with placeholders in .env.example.'
    });
  } else {
    addPass(checks, 'secret-hygiene-clear', 'No obvious committed secrets found', ['Scanned text files without printing secret values.']);
  }

  const envEvidence = [];
  if (hasFile(files, ['.env.example', 'env.example', 'sample.env'])) envEvidence.push('.env.example or equivalent');
  if (includesAny(text, ['environment variable', 'env var', 'agoragentic_api_key', 'api key', 'configuration'])) {
    envEvidence.push('configuration docs');
  }
  if (envEvidence.length) {
    addPass(checks, 'configuration-contract-present', 'Configuration contract exists', unique(envEvidence));
  } else {
    addRisk(risks, checks, {
      id: 'configuration-contract-missing',
      severity: 'warning',
      title: 'Configuration contract is unclear',
      evidence: ['No .env.example or obvious configuration instructions found.'],
      action: 'Add .env.example plus docs for required and optional environment variables, including which calls can spend money.'
    });
  }

  if (includesAny(text, ['max_cost', 'budget', 'spend cap', 'approval', 'no-spend', 'no spend', 'paid execution', 'x402', 'usdc'])) {
    addPass(checks, 'spend-boundary-present', 'Spend boundary is documented', ['Budget, approval, no-spend, paid execution, x402, or USDC language found.']);
  } else {
    addRisk(risks, checks, {
      id: 'spend-boundary-missing',
      severity: 'warning',
      title: 'Spend boundary is not explicit',
      evidence: ['No obvious budget, approval, no-spend, paid execution, x402, or USDC language found.'],
      action: 'Document exactly which paths are free, which can spend, and which owner approval or environment gate is required before paid execution.'
    });
  }

  if (includesAny(text, ['receipt', 'invocation_id', 'trace id', 'trace_id', 'reconciliation', 'audit trail', 'proof'])) {
    addPass(checks, 'receipt-contract-present', 'Receipt or proof contract is documented', ['Receipt, invocation, trace, reconciliation, audit, or proof language found.']);
  } else {
    addRisk(risks, checks, {
      id: 'receipt-contract-missing',
      severity: 'warning',
      title: 'Receipt/proof contract is missing',
      evidence: ['No obvious receipt, invocation, trace, reconciliation, audit, or proof language found.'],
      action: 'Define what artifact proves the agent ran correctly: local receipt JSON, invocation ID, audit trail, or reconciliation record.'
    });
  }

  if (includesAny(text, ['health', '/health', 'ready', 'readiness', 'rollback', 'runbook', 'incident'])) {
    addPass(checks, 'runtime-operations-present', 'Runtime operations notes exist', ['Health, readiness, rollback, runbook, or incident language found.']);
  } else {
    addRisk(risks, checks, {
      id: 'runtime-operations-missing',
      severity: 'info',
      title: 'Runtime operations notes are thin',
      evidence: ['No obvious health, readiness, rollback, runbook, or incident language found.'],
      action: 'Add a short operations section covering health checks, rollback, support contact, and what to do after a failed run.'
    });
  }

  if (includesAny(text, ['agent os', 'execute(', 'execute(task', 'micro ecf', 'agoragentic'])) {
    addPass(checks, 'agoragentic-alignment-present', 'Agoragentic/Agent OS alignment is visible', ['Agent OS, execute(), Micro ECF, or Agoragentic language found.']);
  } else {
    addRisk(risks, checks, {
      id: 'agoragentic-alignment-missing',
      severity: 'info',
      title: 'Agoragentic alignment is not visible',
      evidence: ['No obvious Agent OS, execute(), Micro ECF, or Agoragentic language found.'],
      action: 'If this repo is meant to launch from Agoragentic, document the Agent OS handoff and prefer execute(task,input,constraints) for external work.'
    });
  }

  const summary = summarizeRisks(risks);
  return {
    schema: 'agoragentic.premortem.v1',
    generated_at: generatedAt,
    root,
    repo_fingerprint: repoFingerprint(root, files),
    summary,
    risks: risks.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    checks,
    next_actions: nextActionsFromRisks(risks),
    file_count_scanned: files.length,
    source_files_read: relFiles.slice(0, 120),
    no_spend: true,
    boundary: {
      credentials_required: false,
      paid_execution: false,
      production_mutation: false
    }
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'agoragentic-premortem-golden-loop/0.1'
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: options.redirect || 'follow',
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    let body = raw;
    if (contentType.includes('application/json')) {
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = raw;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      elapsed_ms: Date.now() - started,
      content_type: contentType,
      location: response.headers.get('location') || null,
      body_shape: bodyShape(body)
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      elapsed_ms: Date.now() - started,
      error: err.name === 'AbortError' ? 'timeout' : err.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function bodyShape(body) {
  if (Array.isArray(body)) return { type: 'array', length: body.length };
  if (body && typeof body === 'object') return { type: 'object', keys: Object.keys(body).slice(0, 12) };
  if (typeof body === 'string') return { type: 'text', length: body.length };
  return { type: typeof body };
}

function stage(id, title, status, evidence = [], action = null) {
  return { id, title, status, evidence, action };
}

function stageSummary(stages) {
  return {
    pass: stages.filter((item) => item.status === 'pass').length,
    warn: stages.filter((item) => item.status === 'warn').length,
    fail: stages.filter((item) => item.status === 'fail').length,
    skip: stages.filter((item) => item.status === 'skip').length
  };
}

function findCheck(report, idPrefix) {
  return report.checks.find((check) => check.id.startsWith(idPrefix));
}

async function runPublicCanaries(baseUrl) {
  const cleanBase = String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const probes = [
    {
      id: 'discovery-check',
      title: 'Agoragentic public discovery self-test',
      url: `${cleanBase}/api/discovery/check`,
      method: 'GET',
      accept: [200]
    },
    {
      id: 'x402-info',
      title: 'x402 public info surface',
      url: `${cleanBase}/api/x402/info`,
      method: 'GET',
      accept: [200]
    },
    {
      id: 'x402-test-echo',
      title: 'Free x402 test echo surface',
      url: `${cleanBase}/api/x402/test/echo`,
      method: 'GET',
      accept: [200, 402]
    },
    {
      id: 'catalog-no-spend',
      title: 'No-spend catalog metadata surface',
      url: `${cleanBase}/api/catalog?spend_possible=false&auth=none`,
      method: 'GET',
      accept: [200]
    }
  ];

  const results = [];
  for (const probe of probes) {
    const response = await fetchWithTimeout(probe.url, { method: probe.method });
    const passed = response.status && probe.accept.includes(response.status);
    results.push({
      id: probe.id,
      title: probe.title,
      url: probe.url,
      method: probe.method,
      status: passed ? 'pass' : 'warn',
      http_status: response.status,
      elapsed_ms: response.elapsed_ms,
      evidence: response.error
        ? [`${probe.method} ${probe.url} failed: ${response.error}`]
        : [`${probe.method} ${probe.url} returned HTTP ${response.status}`],
      body_shape: response.body_shape
    });
  }
  return results;
}

// SSRF guard: an authenticated caller can direct the server at an arbitrary
// targetUrl once --allow-remote-network is enabled. Unless the owner ALSO opts
// in to internal targets, block requests that resolve to loopback, link-local
// (incl. the cloud metadata host 169.254.169.254 in any encoding), and RFC1918
// private ranges. We validate the resolved IPs rather than only the hostname
// string so a public name that resolves (or DNS-rebinds) to an internal address
// is still rejected.
function normalizeIpv4(hostname) {
  // Accept dotted-quad, or the decimal/octal/hex encodings Node's URL parser
  // leaves untouched (e.g. 2852039166, 0xA9FEA9FE) and re-render them dotted.
  const asInt = (str) => {
    const trimmed = String(str).trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return Number.parseInt(trimmed, 16);
    if (/^0[0-7]+$/.test(trimmed)) return Number.parseInt(trimmed, 8);
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
    return Number.NaN;
  };
  if (net.isIP(hostname) === 4) return hostname;
  const parts = String(hostname).split('.');
  if (parts.length === 1) {
    const n = asInt(parts[0]);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
  }
  if (parts.length === 4) {
    const octets = parts.map(asInt);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    return octets.join('.');
  }
  return null;
}

function isBlockedIp(ip) {
  if (typeof ip !== 'string') return true;
  const dotted = net.isIP(ip) === 4 ? ip : normalizeIpv4(ip);
  if (dotted) {
    const o = dotted.split('.').map((p) => Number.parseInt(p, 10));
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 127) return true; // loopback 127.0.0.0/8
    if (o[0] === 10) return true; // RFC1918 10/8
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // RFC1918 172.16/12
    if (o[0] === 192 && o[1] === 168) return true; // RFC1918 192.168/16
    if (o[0] === 169 && o[1] === 254) return true; // link-local incl. 169.254.169.254
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true; // unspecified / loopback
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
    // IPv4-mapped / IPv4-compatible: re-check the embedded v4 address.
    const embedded = lower.match(/(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (embedded) return isBlockedIp(embedded[1]);
    return false;
  }
  return true; // unparseable → block
}

async function assertPublicTarget(rawUrl, allowInternalTargets) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`blocked scheme ${parsed.protocol} (only http:/https: allowed)`);
  }
  if (allowInternalTargets) return;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  // Literal IP in the URL — check it directly (covers decimal/octal/hex 169.254.169.254).
  const literal = net.isIP(hostname) ? hostname : normalizeIpv4(hostname);
  if (literal && net.isIP(literal)) {
    if (isBlockedIp(literal)) throw new Error(`blocked internal target ${hostname}`);
    return;
  }
  // Hostname — resolve every A/AAAA record and block if ANY is internal
  // (defends against DNS rebinding and split-horizon answers).
  let addresses = [];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`could not resolve ${hostname}: ${err.message}`);
  }
  if (!addresses.length) throw new Error(`could not resolve ${hostname}`);
  for (const { address } of addresses) {
    if (isBlockedIp(address)) throw new Error(`${hostname} resolves to blocked internal address ${address}`);
  }
}

async function runTargetChecks(targetUrl, options = {}) {
  if (!targetUrl) return [];
  const allowInternalTargets = Boolean(options.allowInternalTargets);
  const clean = String(targetUrl).replace(/\/$/, '');
  const candidates = [
    clean,
    `${clean}/health`,
    `${clean}/.well-known/agent.json`,
    `${clean}/agent.json`,
    `${clean}/openapi.json`,
    `${clean}/openapi.yaml`
  ];
  const checks = [];
  for (const url of candidates) {
    let response;
    try {
      // Validate scheme + resolved host BEFORE issuing the request.
      await assertPublicTarget(url, allowInternalTargets);
      // redirect:'manual' so a public URL cannot 3xx-redirect into an internal
      // host after we validated the original target.
      response = await fetchWithTimeout(url, { method: 'GET', timeoutMs: 8000, redirect: 'manual' });
      // Re-validate any redirect Location against the same allowlist.
      if (!response.error && response.location) {
        const nextUrl = new URL(response.location, url).toString();
        await assertPublicTarget(nextUrl, allowInternalTargets);
      }
    } catch (err) {
      checks.push({
        url,
        status: 'warn',
        http_status: null,
        elapsed_ms: 0,
        evidence: [`GET ${url} blocked: ${err.message}`]
      });
      continue;
    }
    checks.push({
      url,
      status: response.status && response.status < 500 ? 'pass' : 'warn',
      http_status: response.status,
      elapsed_ms: response.elapsed_ms,
      body_shape: response.body_shape,
      evidence: response.error ? [`GET ${url} failed: ${response.error}`] : [`GET ${url} returned HTTP ${response.status}`]
    });
  }
  return checks;
}

async function runDeclaredTests(root, enabled) {
  if (!enabled) {
    return stage(
      'declared-tests',
      'Declared repo tests',
      'skip',
      ['Skipped. Pass --run-tests to run package.json scripts.test with AGORAGENTIC_NO_SPEND=1.']
    );
  }

  const packageJson = await readJson(path.join(root, 'package.json'));
  if (!packageJson?.scripts?.test) {
    return stage(
      'declared-tests',
      'Declared repo tests',
      'skip',
      ['No package.json scripts.test found.']
    );
  }

  const testCommand = process.platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm test'] }
    : { command: 'npm', args: ['test'] };
  const result = await spawnForReceipt(testCommand.command, testCommand.args, {
    cwd: root,
    timeoutMs: 120000,
    env: sanitizeEnv({
      ...process.env,
      AGORAGENTIC_NO_SPEND: '1',
      AGORAGENTIC_ALLOW_REAL_SPEND: '0'
    })
  });

  return stage(
    'declared-tests',
    'Declared repo tests',
    result.exit_code === 0 ? 'pass' : 'fail',
    [
      `npm test exited ${result.exit_code}`,
      ...result.output_tail
    ],
    result.exit_code === 0 ? null : 'Fix the declared test suite before publishing the agent.'
  );
}

function spawnForReceipt(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ exit_code: 1, output_tail: [`spawn failed: ${err.message}`] });
      return;
    }
    const chunks = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs || 120000);
    child.stdout.on('data', (chunk) => chunks.push(String(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(String(chunk)));
    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ exit_code: 1, output_tail: [`spawn failed: ${err.message}`] });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const lines = chunks.join('').split(/\r?\n/).filter(Boolean).slice(-12);
      resolve({ exit_code: code ?? 1, output_tail: lines });
    });
  });
}

function sanitizeEnv(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value).replace(/\0/g, '')])
  );
}

export async function runGoldenLoop(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const premortem = options.premortem || await runPremortem({ repo: root });
  const stages = [];

  const installCheck = findCheck(premortem, 'install-contract');
  stages.push(stage(
    'install-contract',
    'Install contract',
    installCheck?.status === 'pass' ? 'pass' : 'fail',
    installCheck?.evidence || [],
    installCheck?.status === 'pass' ? null : 'Add a reproducible install contract before release.'
  ));

  const configCheck = findCheck(premortem, 'configuration-contract');
  const secretCheck = findCheck(premortem, 'secret-hygiene');
  stages.push(stage(
    'configure-contract',
    'Configuration and secret boundary',
    configCheck?.status === 'pass' && secretCheck?.status === 'pass' ? 'pass' : 'warn',
    unique([...(configCheck?.evidence || []), ...(secretCheck?.evidence || [])]),
    configCheck?.status === 'pass' && secretCheck?.status === 'pass'
      ? null
      : 'Add .env.example/config docs and remove or rotate any committed secret-like values.'
  ));

  const discoveryCheck = findCheck(premortem, 'agent-discovery');
  stages.push(stage(
    'agent-discovery',
    'Agent discovery contract',
    discoveryCheck?.status === 'pass' ? 'pass' : 'warn',
    discoveryCheck?.evidence || [],
    discoveryCheck?.status === 'pass' ? null : 'Add agent.json, agent-card.json, SKILL.md, OpenAPI, MCP, or equivalent discovery metadata.'
  ));

  stages.push(stage(
    'premortem-risk',
    'Premortem risk gate',
    premortem.summary.blockers === 0 ? 'pass' : 'fail',
    [`${premortem.summary.blockers} blockers, ${premortem.summary.warnings} warnings, score ${premortem.summary.score}`],
    premortem.summary.blockers === 0 ? null : 'Resolve premortem blockers before release.'
  ));

  const receiptCheck = findCheck(premortem, 'receipt-contract');
  stages.push(stage(
    'receipt-contract',
    'Receipt and proof contract',
    receiptCheck?.status === 'pass' ? 'pass' : 'warn',
    receiptCheck?.evidence || [],
    receiptCheck?.status === 'pass' ? null : 'Define the local receipt or hosted invocation proof consumers can inspect after a run.'
  ));

  const spendCheck = findCheck(premortem, 'spend-boundary');
  stages.push(stage(
    'owner-spend-boundary',
    'Owner approval and spend boundary',
    spendCheck?.status === 'pass' ? 'pass' : 'warn',
    spendCheck?.evidence || [],
    spendCheck?.status === 'pass' ? null : 'Document no-spend defaults, paid execution gates, budgets, and owner approval requirements.'
  ));

  const runNetworkCanaries = Boolean(options.allowNetworkCanaries) && !options.skipNetwork;
  if (!runNetworkCanaries) {
    stages.push(stage(
      'public-no-spend-canaries',
      'Public no-spend Agoragentic canaries',
      'skip',
      [options.skipNetwork ? 'Skipped by --skip-network.' : 'Skipped by default. Pass --allow-network-canaries to call public no-spend endpoints without sending repo contents.']
    ));
  } else {
    const canaries = await runPublicCanaries(options.baseUrl || DEFAULT_BASE_URL);
    const failed = canaries.filter((item) => item.status !== 'pass');
    stages.push(stage(
      'public-no-spend-canaries',
      'Public no-spend Agoragentic canaries',
      failed.length ? 'warn' : 'pass',
      canaries.flatMap((item) => item.evidence),
      failed.length ? 'Check public connectivity before treating the loop as externally verifiable.' : null
    ));
    stages[stages.length - 1].canaries = canaries;
  }

  const targetChecks = await runTargetChecks(options.targetUrl, {
    allowInternalTargets: Boolean(options.allowInternalTargets)
  });
  if (targetChecks.length) {
    const targetPass = targetChecks.some((item) => item.status === 'pass' && item.http_status && item.http_status < 400);
    stages.push(stage(
      'target-runtime',
      'Optional target runtime',
      targetPass ? 'pass' : 'warn',
      targetChecks.flatMap((item) => item.evidence),
      targetPass ? null : 'Expose a health endpoint or discovery document at the target runtime URL.'
    ));
    stages[stages.length - 1].target_checks = targetChecks;
  } else {
    stages.push(stage(
      'target-runtime',
      'Optional target runtime',
      'skip',
      ['No --target-url provided.']
    ));
  }

  stages.push(await runDeclaredTests(root, Boolean(options.runTests)));

  const summary = stageSummary(stages);
  const generatedAt = nowIso();
  return {
    schema: 'agoragentic.golden-loop.no-spend.v1',
    generated_at: generatedAt,
    root,
    target_url: options.targetUrl || null,
    summary,
    stages,
    pass: summary.fail === 0,
    no_spend: true,
    boundary: {
      free_to_use: true,
      local_artifacts_only: !runNetworkCanaries && !options.targetUrl,
      network_calls: runNetworkCanaries || Boolean(options.targetUrl),
      repo_contents_uploaded: false,
      credentials_required: false,
      paid_execution: false,
      production_mutation: false,
      real_usdc_transfer: false
    }
  };
}

export async function runDoctor(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const generatedAt = nowIso();
  const rootExists = await exists(root);
  const files = rootExists ? await walkFiles(root, { maxFiles: 2500 }) : [];
  const packageJson = rootExists ? await readJson(path.join(root, 'package.json')) : null;

  return {
    schema: 'agoragentic.premortem-golden-loop.doctor.v1',
    generated_at: generatedAt,
    root,
    status: rootExists ? 'ready' : 'blocked',
    summary: rootExists
      ? `Ready to run a local no-spend audit on ${files.length} discovered file(s).`
      : 'Repository path does not exist. No audit or self-heal should run until the path is corrected.',
    detected: {
      file_count: files.length,
      package_name: packageJson?.name || null,
      has_package_json: Boolean(packageJson),
      has_readme: rootExists && hasFile(files, ['README.md', 'README.txt', 'readme.md']),
      has_license: rootExists && hasFile(files, ['LICENSE', 'LICENSE.md', 'COPYING'])
    },
    what_it_does: [
      'Runs a local repo premortem for release and operating risks.',
      'Runs a no-spend Golden Loop readiness check.',
      'Writes local receipts, Markdown summaries, and an HTML guide.',
      'Builds a self-heal plan and IDE/agent handoff prompt from the findings.',
      'Creates safe missing scaffolds only when --apply-safe-fixes is passed.'
    ],
    reads: [
      'File names and selected text files under the repository root.',
      'README, docs, package metadata, agent descriptors, env examples, and test metadata.',
      'Secret-like patterns are reported by file and line only; values are not echoed.'
    ],
    writes: [
      '.agoragentic/premortem-golden-loop/*.json',
      '.agoragentic/premortem-golden-loop/*.md',
      '.agoragentic/premortem-golden-loop/*.html',
      'Only missing additive scaffold files when --apply-safe-fixes is explicitly passed.'
    ],
    never: [
      'No deletes.',
      'No overwrites of existing project files.',
      'No application source rewrites.',
      'No dependency installation.',
      'No deployment, publishing, paid execute() call, wallet signing, or USDC transfer.',
      'No network calls unless --allow-network-canaries or --target-url is explicitly passed.',
      'No repository contents uploaded by default.'
    ],
    recommended_commands: [
      'npx agoragentic-premortem-golden-loop audit --repo .',
      'npx agoragentic-premortem-golden-loop audit --repo . --plan "Describe the launch or decision" --audience "Who it is for" --success "What a win looks like"',
      'npx agoragentic-premortem-golden-loop audit --repo . --apply-safe-fixes',
      'npx agoragentic-premortem-golden-loop audit --repo . --ci --run-tests'
    ],
    boundary: LOCAL_PRIVACY_BOUNDARY
  };
}

export async function runAudit(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const generatedAt = nowIso();
  const timestamp = timestampSlug(generatedAt);
  const doctor = await runDoctor({ ...options, repo: root });
  const repoAudit = await runAll({ ...options, repo: root });
  const healing = await runHeal({ ...options, repo: root, skipNetwork: true });
  const premortemSession = await runPremortemSession({ ...options, repo: root });
  const effectiveAudit = healing.after || repoAudit;
  const status = doctor.status === 'blocked'
    ? 'blocked'
    : premortemSession.status === 'needs_context'
      ? 'needs_context'
      : effectiveAudit.receipt.pass
        ? 'ready'
        : 'needs_fixes';

  const audit = {
    schema: 'agoragentic.premortem-golden-loop.audit.v1',
    generated_at: generatedAt,
    timestamp,
    root,
    status,
    doctor,
    repo_audit: repoAudit,
    effective_audit: effectiveAudit,
    premortem_session: premortemSession,
    healing,
    no_spend: true,
    boundary: {
      local_by_default: true,
      free_to_use: true,
      repo_contents_uploaded: false,
      credentials_required: false,
      paid_execution: false,
      production_mutation: false,
      destructive_changes: false,
      self_heal_overwrites_existing_files: false,
      self_heal_deletes_files: false
    }
  };
  audit.closure_loop = await buildClosureLoop(audit, null);
  audit.handoff = buildIdeHandoff(audit);
  audit.launch_gate = buildLaunchGate(audit);
  return audit;
}

export async function runAll(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const premortem = await runPremortem({ repo: root });
  const goldenLoop = await runGoldenLoop({ ...options, repo: root, premortem });
  const receipt = buildLocalReceipt({ root, premortem, goldenLoop });
  return { premortem, golden_loop: goldenLoop, receipt };
}

export async function runHeal(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const before = await runAll({ ...options, repo: root, skipNetwork: true });
  const plan = await buildHealingPlan({ root, premortem: before.premortem, goldenLoop: before.golden_loop });
  const applied = options.applySafeFixes ? await applyHealingPlan(root, plan) : [];
  const after = options.applySafeFixes
    ? await runAll({ ...options, repo: root, skipNetwork: true })
    : null;

  return {
    schema: 'agoragentic.premortem-golden-loop.heal.v1',
    generated_at: nowIso(),
    root,
    mode: options.applySafeFixes ? 'apply_safe_fixes' : 'plan_only',
    free_to_use: true,
    privacy: LOCAL_PRIVACY_BOUNDARY,
    before,
    plan,
    applied,
    after,
    boundary: {
      local_only: true,
      network_calls: false,
      credentials_required: false,
      paid_execution: false,
      production_mutation: false,
      code_rewrite: false,
      destructive_changes: false
    }
  };
}

const LOCAL_PRIVACY_BOUNDARY = {
  default_network: false,
  data_sent_anywhere: false,
  repo_contents_uploaded: false,
  api_key_required: false,
  cost_usdc: 0,
  note: 'Default heal/run/session modes read local files and write local artifacts only. Public no-spend canaries run only when the caller explicitly opts in.'
};

async function buildHealingPlan({ root, premortem, goldenLoop }) {
  const files = await walkFiles(root, { maxFiles: 2500 });
  const rels = new Set(files.map((file) => relative(root, file).toLowerCase()));
  const packageJson = await readJson(path.join(root, 'package.json'));
  const projectName = packageJson?.name || path.basename(root);
  const actions = [];

  const addCreate = (id, target, title, reason, content) => {
    if (rels.has(slash(target).toLowerCase())) {
      actions.push({
        id,
        type: 'skip_existing',
        target,
        title,
        reason: `${target} already exists.`
      });
      return;
    }
    actions.push({
      id,
      type: 'create_file',
      target,
      title,
      reason,
      content
    });
  };

  addCreate(
    'goals-doc',
    'docs/AGORAGENTIC_GOALS.md',
    'Create goals contract',
    'Every self-testing agent needs explicit goals, non-goals, success signals, and owner review checkpoints.',
    renderGoalsDoc({ projectName })
  );
  addCreate(
    'workflows-doc',
    'docs/AGORAGENTIC_WORKFLOWS.md',
    'Create workflows contract',
    'The agent should give users repeatable local workflows for premortem, self-test, self-heal, release, and Agent OS handoff.',
    renderWorkflowsDoc({ projectName })
  );
  addCreate(
    'safety-boundaries-doc',
    'docs/AGORAGENTIC_SAFETY_BOUNDARIES.md',
    'Create safety boundaries contract',
    'Users need a direct statement that default runs are free, local, no-network, no-spend, and non-mutating unless explicitly approved.',
    renderSafetyBoundariesDoc({ projectName })
  );

  if (premortem.checks.some((check) => check.id.startsWith('agent-discovery') && check.status !== 'pass')) {
    addCreate(
      'agent-descriptor',
      'agent.json',
      'Create local agent descriptor',
      'Machine-readable agent metadata helps humans and agent runtimes understand purpose, inputs, outputs, and authority boundaries.',
      `${JSON.stringify(buildAgentDescriptor(projectName), null, 2)}\n`
    );
  }

  if (premortem.checks.some((check) => check.id.startsWith('configuration-contract') && check.status !== 'pass')) {
    addCreate(
      'env-example',
      '.env.example',
      'Create local environment example',
      'Configuration should be explicit even when no credentials are required by default.',
      renderEnvExample()
    );
  }

  if (premortem.checks.some((check) => check.id.startsWith('test-contract') && check.status !== 'pass')) {
    addCreate(
      'ci-workflow',
      '.github/workflows/agoragentic-premortem-golden-loop.yml',
      'Create no-spend CI workflow',
      'A repeatable self-test loop makes release readiness visible on every push without credentials or paid calls.',
      renderGithubWorkflow()
    );
  }

  const manual = [];
  if (premortem.risks.some((risk) => risk.id === 'secret-hygiene-failed')) {
    manual.push({
      id: 'rotate-secrets',
      title: 'Remove and rotate committed secrets',
      reason: 'The agent will not edit or delete secret-bearing files automatically.',
      action: 'Remove the secret manually, rotate it with the provider, then rerun heal.'
    });
  }
  if (premortem.risks.some((risk) => risk.id === 'license-missing')) {
    manual.push({
      id: 'choose-license',
      title: 'Choose an OSS license',
      reason: 'License choice is a project decision.',
      action: 'Add LICENSE with the license the owner wants before public release.'
    });
  }

  return {
    summary: {
      proposed_file_creates: actions.filter((action) => action.type === 'create_file').length,
      skipped_existing: actions.filter((action) => action.type === 'skip_existing').length,
      manual_actions: manual.length,
      golden_loop_pass_before: goldenLoop.pass,
      blockers_before: premortem.summary.blockers
    },
    actions,
    manual,
    safety: {
      applies_only_when_flagged: '--apply-safe-fixes',
      writes_only_new_files: true,
      overwrites_existing_files: false,
      deletes_files: false,
      edits_application_code: false,
      sends_data: false,
      costs_money: false
    }
  };
}

async function applyHealingPlan(root, plan) {
  const applied = [];
  if (!await exists(root)) {
    return plan.actions
      .filter((action) => action.type === 'create_file')
      .map((action) => ({ ...action, status: 'blocked', reason: 'Repository root does not exist.' }));
  }
  for (const action of plan.actions) {
    if (action.type !== 'create_file') continue;
    const full = path.resolve(root, action.target);
    if (!isInside(root, full)) {
      applied.push({ ...action, status: 'blocked', reason: 'Target path escapes repo root.' });
      continue;
    }
    if (await exists(full)) {
      applied.push({ ...action, status: 'skipped_existing' });
      continue;
    }
    await writeText(full, action.content);
    applied.push({ id: action.id, target: action.target, status: 'created' });
  }
  return applied;
}

function isInside(root, target) {
  const relativePath = path.relative(root, target);
  return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function buildAgentDescriptor(projectName) {
  return {
    schema: 'agoragentic.local-agent.v1',
    name: projectName,
    description: 'Local AI agent prepared with Agoragentic Premortem Golden Loop.',
    free_to_use: true,
    default_boundary: {
      local_only: true,
      network_calls: false,
      credentials_required: false,
      paid_execution: false,
      production_mutation: false,
      repo_contents_uploaded: false
    },
    workflows: [
      'doctor',
      'audit',
      'premortem',
      'self-test',
      'self-heal-plan',
      'golden-loop-readiness'
    ],
    artifacts: [
      '.agoragentic/premortem-golden-loop/audit-guide.html',
      '.agoragentic/premortem-golden-loop/audit-summary.md',
      '.agoragentic/premortem-golden-loop/closure-loop.json',
      '.agoragentic/premortem-golden-loop/closure-loop.md',
      '.agoragentic/premortem-golden-loop/ide-fix-prompt.md',
      '.agoragentic/premortem-golden-loop/premortem.json',
      '.agoragentic/premortem-golden-loop/golden-loop.json',
      '.agoragentic/premortem-golden-loop/local-receipt.json',
      '.agoragentic/premortem-golden-loop/healing-plan.json'
    ]
  };
}

function buildIdeHandoff(audit) {
  const effective = audit.effective_audit;
  const nextActions = effective.premortem.next_actions.slice(0, 8);
  const safeCreates = audit.healing.plan.actions
    .filter((action) => action.type === 'create_file')
    .map((action) => ({
      id: action.id,
      target: action.target,
      reason: action.reason
    }));
  const manual = audit.healing.plan.manual;

  return {
    title: 'Local IDE / Agent Handoff',
    purpose: 'Use these findings to improve Golden Loop readiness without destructive changes.',
    files_to_read_first: [
      '.agoragentic/premortem-golden-loop/audit-summary.md',
      '.agoragentic/premortem-golden-loop/closure-loop.md',
      '.agoragentic/premortem-golden-loop/healing-plan.md',
      '.agoragentic/premortem-golden-loop/golden-loop.md',
      '.agoragentic/premortem-golden-loop/premortem.md',
      '.agoragentic/premortem-golden-loop/ide-fix-prompt.md'
    ],
    guardrails: [
      'Do not delete files.',
      'Do not overwrite existing files.',
      'Do not edit application source code unless the owner asks for a reviewed patch.',
      'Do not rotate secrets, deploy, publish, install dependencies, call paid execute(), sign wallet messages, or transfer funds.',
      'Do not make network calls unless the owner explicitly provides a target URL or network-canary flag.',
      'If a fix requires changing existing behavior, produce a patch proposal and ask for approval.'
    ],
    current_findings: {
      status: audit.status,
      premortem_score: effective.premortem.summary.score,
      blockers: effective.premortem.summary.blockers,
      warnings: effective.premortem.summary.warnings,
      golden_loop_failures: effective.golden_loop.summary.fail,
      golden_loop_warnings: effective.golden_loop.summary.warn,
      premortem_context_status: audit.premortem_session.status
    },
    next_actions: nextActions,
    safe_additive_implementations: safeCreates,
    manual_owner_actions: manual,
    suggested_sequence: [
      'Read the generated audit artifacts.',
      'Apply only safe missing scaffolds with --apply-safe-fixes, or implement equivalent additions manually.',
      'Handle manual owner actions separately, especially license choice and secret rotation.',
      'Run the repo test suite only when it is safe in no-spend mode.',
      'Rerun audit with --ci and keep the resulting local receipt.',
      'Check closure-loop.md to confirm which prior recommendations are now applied, verified resolved, or still open.'
    ],
    rerun_command: 'npx agoragentic-premortem-golden-loop audit --repo . --ci --run-tests'
  };
}

function buildLaunchGate(audit) {
  const effective = audit.effective_audit;
  const sourceFiles = effective.premortem.source_files_read || [];
  const context = audit.premortem_session.context || {};
  const missing = context.missing || [];
  const assumptionsRefused = audit.premortem_session.status === 'needs_context'
    ? [`Refused to invent missing premortem context: ${missing.join(', ') || 'unspecified context'}.`]
    : [
        'Did not invent private team politics, customer urgency, production runtime state, credentials, or paid execution proof beyond supplied plan and local repo context.',
        'Plan, audience, and success criteria were supplied or inferred from local workspace context before running the full premortem.'
      ];
  const riskyActionsBlocked = [
    'Delete files',
    'Overwrite existing files',
    'Rewrite application source code without owner-reviewed patch approval',
    'Rotate secrets',
    'Install dependencies',
    'Deploy or publish',
    'Call paid execute()',
    'Sign wallet messages or transfer USDC',
    'Upload repository contents by default'
  ];

  return {
    source_files_read: {
      count: effective.premortem.file_count_scanned || sourceFiles.length,
      files: sourceFiles,
      truncated: sourceFiles.length >= 120
    },
    assumptions_refused: assumptionsRefused,
    risky_actions_blocked: riskyActionsBlocked,
    ide_prompt_handed_off: {
      artifact: 'ide-fix-prompt.md',
      exact_prompt: renderIdeFixPrompt(audit, 'local IDE agent')
    }
  };
}

async function buildClosureLoop(audit, previousAudit = null) {
  const generatedAt = audit.generated_at || nowIso();
  const root = audit.root;
  const effective = audit.effective_audit;
  const currentRisks = new Map((effective.premortem.risks || []).map((risk) => [risk.id, risk]));
  const currentManual = new Map((audit.healing.plan.manual || []).map((item) => [item.id, item]));
  const applied = new Map((audit.healing.applied || []).map((item) => [safeCreateKey(item.target || item.id), item]));
  const items = new Map();

  const addOrUpdate = (item) => {
    const existing = items.get(item.id);
    if (!existing) {
      items.set(item.id, item);
      return;
    }
    items.set(item.id, {
      ...existing,
      ...item,
      first_seen_at: existing.first_seen_at || item.first_seen_at,
      carried_forward: existing.carried_forward || item.carried_forward
    });
  };

  for (const item of previousClosureItems(previousAudit)) {
    const evaluated = await evaluatePriorClosureItem(root, item, currentRisks, currentManual, generatedAt);
    addOrUpdate(evaluated);
  }

  for (const risk of effective.premortem.risks || []) {
    addOrUpdate({
      id: riskKey(risk.id),
      type: 'risk_action',
      status: 'open',
      title: risk.title,
      risk_id: risk.id,
      severity: risk.severity,
      action: risk.action,
      evidence: ['Risk is present in the current premortem scan.'],
      first_seen_at: generatedAt,
      last_checked_at: generatedAt,
      carried_forward: false
    });
  }

  for (const action of audit.healing.plan.actions || []) {
    if (action.type !== 'create_file') continue;
    const key = safeCreateKey(action.target);
    const appliedItem = applied.get(key);
    addOrUpdate({
      id: key,
      type: 'safe_create',
      status: appliedItem?.status === 'created'
        ? 'applied_this_run'
        : appliedItem?.status === 'blocked'
          ? 'blocked'
          : await fileExistsInRoot(root, action.target)
            ? 'verified_present'
            : 'open',
      title: action.title,
      target: action.target,
      action: action.reason,
      evidence: closureEvidenceForSafeCreate(appliedItem, action.target),
      first_seen_at: generatedAt,
      last_checked_at: generatedAt,
      carried_forward: false
    });
  }

  for (const manual of audit.healing.plan.manual || []) {
    addOrUpdate({
      id: manualKey(manual.id),
      type: 'manual_action',
      status: 'manual_open',
      title: manual.title,
      action: manual.action,
      evidence: ['Manual owner action is still present in the current healing plan.'],
      first_seen_at: generatedAt,
      last_checked_at: generatedAt,
      carried_forward: false
    });
  }

  for (const item of audit.healing.applied || []) {
    const key = safeCreateKey(item.target || item.id);
    addOrUpdate({
      id: key,
      type: 'safe_create',
      status: item.status === 'created' ? 'applied_this_run' : item.status,
      title: item.title || item.id || item.target,
      target: item.target || null,
      action: item.reason || 'Safe additive scaffold action from this run.',
      evidence: closureEvidenceForSafeCreate(item, item.target),
      first_seen_at: generatedAt,
      last_checked_at: generatedAt,
      carried_forward: false
    });
  }

  const ordered = [...items.values()].sort((a, b) => closureStatusRank(a.status) - closureStatusRank(b.status) || a.id.localeCompare(b.id));
  const summary = summarizeClosure(ordered);
  return {
    schema: 'agoragentic.premortem-golden-loop.closure-loop.v1',
    generated_at: generatedAt,
    root,
    previous_audit_found: Boolean(previousAudit),
    previous_generated_at: previousAudit?.generated_at || null,
    previous_receipt_id: previousAudit?.effective_audit?.receipt?.receipt_id || null,
    current_receipt_id: effective.receipt.receipt_id,
    summary,
    items: ordered,
    how_to_close_loop: [
      'Apply approved safe fixes or equivalent owner-reviewed changes.',
      'Rerun audit against the same output directory so prior local artifacts can be compared with the current repo state.',
      'Review closure-loop.md or closure-loop.json for applied, verified resolved, blocked, and still-open items.'
    ],
    boundary: {
      local_only: true,
      compared_previous_local_artifact: Boolean(previousAudit),
      network_calls: false,
      repo_contents_uploaded: false,
      destructive_changes: false,
      source_rewrites: false,
      paid_execution: false
    }
  };
}

function previousClosureItems(previousAudit) {
  if (!previousAudit) return [];
  if (Array.isArray(previousAudit.closure_loop?.items)) return previousAudit.closure_loop.items;

  const items = [];
  for (const action of previousAudit.handoff?.next_actions || []) {
    items.push({
      id: riskKey(action.risk_id || action.action),
      type: 'risk_action',
      title: action.action,
      risk_id: action.risk_id,
      severity: action.severity,
      action: action.action,
      first_seen_at: previousAudit.generated_at
    });
  }
  for (const action of previousAudit.handoff?.safe_additive_implementations || []) {
    items.push({
      id: safeCreateKey(action.target || action.id),
      type: 'safe_create',
      title: action.target || action.id,
      target: action.target,
      action: action.reason,
      first_seen_at: previousAudit.generated_at
    });
  }
  for (const action of previousAudit.handoff?.manual_owner_actions || []) {
    items.push({
      id: manualKey(action.id || action.title),
      type: 'manual_action',
      title: action.title,
      action: action.action,
      first_seen_at: previousAudit.generated_at
    });
  }
  return items;
}

async function evaluatePriorClosureItem(root, item, currentRisks, currentManual, generatedAt) {
  const base = {
    ...item,
    first_seen_at: item.first_seen_at || generatedAt,
    last_checked_at: generatedAt,
    carried_forward: true
  };

  if (item.type === 'risk_action') {
    const risk = currentRisks.get(item.risk_id);
    return risk
      ? {
          ...base,
          status: 'open',
          title: risk.title || item.title,
          severity: risk.severity || item.severity,
          action: risk.action || item.action,
          evidence: ['Carried forward: risk still appears in the current premortem scan.']
        }
      : {
          ...base,
          status: 'verified_resolved',
          evidence: ['Prior risk no longer appears in the current premortem scan.']
        };
  }

  if (item.type === 'safe_create') {
    const present = item.target ? await fileExistsInRoot(root, item.target) : false;
    return {
      ...base,
      status: present ? 'verified_present' : 'open',
      evidence: present
        ? [`Verified ${item.target} exists in the current repo.`]
        : [`${item.target || item.id} is not present yet.`]
    };
  }

  if (item.type === 'manual_action') {
    const manualId = item.id?.replace(/^manual:/, '');
    const stillOpen = currentManual.has(manualId);
    return {
      ...base,
      status: stillOpen ? 'manual_open' : 'verified_resolved',
      evidence: stillOpen
        ? ['Manual owner action is still present in the current healing plan.']
        : ['Manual owner action no longer appears in the current healing plan.']
    };
  }

  return {
    ...base,
    status: item.status || 'open',
    evidence: item.evidence || ['Prior closure item carried forward.']
  };
}

async function fileExistsInRoot(root, relPath) {
  if (!relPath) return false;
  const full = path.resolve(root, relPath);
  if (!isInside(root, full)) return false;
  return exists(full);
}

function riskKey(id) {
  return `risk:${id || 'unknown'}`;
}

function safeCreateKey(target) {
  return `safe_create:${slash(String(target || 'unknown'))}`;
}

function manualKey(id) {
  return `manual:${id || 'unknown'}`;
}

function closureEvidenceForSafeCreate(appliedItem, target) {
  if (!appliedItem) return [`${target} is proposed but not applied by this run.`];
  if (appliedItem.status === 'created') return [`Created ${target} during this run.`];
  if (appliedItem.status === 'blocked') return [`Blocked ${target}: ${appliedItem.reason || 'safety boundary prevented the action.'}`];
  if (appliedItem.status === 'skipped_existing') return [`Skipped ${target} because it already existed.`];
  return [`${target || appliedItem.id} status: ${appliedItem.status}.`];
}

function summarizeClosure(items) {
  const count = (status) => items.filter((item) => item.status === status).length;
  const closed = ['applied_this_run', 'verified_resolved', 'verified_present', 'already_present', 'skipped_existing']
    .reduce((total, status) => total + count(status), 0);
  const stillOpen = count('open') + count('manual_open');
  return {
    total: items.length,
    closed,
    applied_this_run: count('applied_this_run'),
    verified_resolved: count('verified_resolved'),
    verified_present: count('verified_present'),
    still_open: stillOpen,
    open: count('open'),
    manual_open: count('manual_open'),
    blocked: count('blocked'),
    carried_forward: items.filter((item) => item.carried_forward).length,
    new_this_run: items.filter((item) => !item.carried_forward).length
  };
}

function closureStatusRank(status) {
  return {
    blocked: 0,
    open: 1,
    manual_open: 2,
    applied_this_run: 3,
    verified_resolved: 4,
    verified_present: 5,
    already_present: 6,
    skipped_existing: 7
  }[status] ?? 8;
}

function itemLabel(item) {
  if (item.target) return item.target;
  if (item.risk_id) return item.risk_id;
  return item.title || item.id;
}

function renderGoalsDoc({ projectName }) {
  return `# Agoragentic Goals

Project: ${projectName}

## Primary Goal

Make the agent safe to install, inspect, test, and improve locally before any hosted deployment, paid execution, marketplace exposure, or x402 monetization.

## Success Signals

- A new user can run the local premortem and Golden Loop readiness check from a clean checkout.
- A new user or IDE agent can run \`doctor --repo .\` and understand the local/no-spend boundary before any audit.
- A repository owner can run \`audit --repo .\` and receive an HTML guide, Golden Loop receipt, healing plan, and IDE handoff prompt.
- The run produces local receipts under \`.agoragentic/premortem-golden-loop/\`.
- The user can see exactly what passed, what failed, and what changed.
- Any self-healing change is additive, reviewable, and made only after explicit approval.

## Non-Goals

- No autonomous deployment.
- No wallet funding or USDC transfer.
- No paid \`execute()\` call.
- No secret rotation on the user's behalf.
- No upload of repo contents, prompts, plans, receipts, or code.

## Owner Review Checkpoints

- Before applying generated fixes.
- Before enabling network canaries.
- Before connecting Agent OS, Micro ECF, x402, or marketplace flows.
- Before publishing any generated report publicly.
`;
}

function renderWorkflowsDoc({ projectName }) {
  return `# Agoragentic Workflows

Project: ${projectName}

## 1. Doctor / Consent Gate

\`\`\`bash
npx agoragentic-premortem-golden-loop doctor --repo .
\`\`\`

Output: local doctor artifact explaining what the agent reads, what it writes, and what it will never do.

## 2. One-Command Local Audit

\`\`\`bash
npx agoragentic-premortem-golden-loop audit --repo . \\
  --plan "Describe the launch or decision" \\
  --audience "Who this is for" \\
  --success "What a win looks like"
\`\`\`

Output: audit guide HTML, premortem report/transcript when context is sufficient, Golden Loop receipt, healing plan, and IDE/agent handoff prompts.

## 3. Local Self-Test

\`\`\`bash
npx agoragentic-premortem-golden-loop run --repo . --ci --skip-network
\`\`\`

Output: premortem audit, no-spend Golden Loop readiness report, and local receipt.

## 4. Self-Heal Plan

\`\`\`bash
npx agoragentic-premortem-golden-loop heal --repo .
\`\`\`

Output: proposed safe fixes only. No files are changed.

## 5. Apply Safe Fixes

\`\`\`bash
npx agoragentic-premortem-golden-loop audit --repo . --apply-safe-fixes
\`\`\`

Only additive docs, metadata, env examples, or CI scaffolds are created. Existing files are not overwritten.

## 6. IDE / Agent Handoff

Use \`.agoragentic/premortem-golden-loop/ide-fix-prompt.md\` or \`.agoragentic/premortem-golden-loop/agent-handoff.md\` with a local IDE agent. The handoff prompt repeats the non-destructive boundaries and points to the exact local artifacts to inspect before proposing or applying fixes.

## 7. MCP / Docker / CI Integrations

See \`docs/INTEGRATIONS.md\` for ready-to-copy setup for MCP clients, Cursor, Claude Code, Codex, Cline, Windsurf, Antigravity, GitHub Actions, Docker, and systemd home-server timers.

## 8. Optional Public No-Spend Canaries

\`\`\`bash
npx agoragentic-premortem-golden-loop audit --repo . --allow-network-canaries
\`\`\`

This calls public Agoragentic no-spend endpoints. It does not send repository contents.

## 9. Agent OS Handoff

Use Agent OS or Micro ECF only after local readiness is clean and the owner approves. Hosted deployment, wallet funding, marketplace publication, x402 monetization, and paid execution are separate explicit steps.
`;
}

function renderSafetyBoundariesDoc({ projectName }) {
  return `# Agoragentic Safety Boundaries

Project: ${projectName}

## Default Boundary

- Free to use.
- Local file reads only.
- Local artifact writes only.
- No API key required.
- No wallet required.
- No network calls by default.
- No repository contents, business plans, prompts, or receipts are sent anywhere.
- No paid execution.
- No production mutation.
- No deployment.
- No marketplace publication.

## What Self-Heal May Do

Only when \`--apply-safe-fixes\` is passed, the agent may create missing additive scaffolds:

- \`docs/AGORAGENTIC_GOALS.md\`
- \`docs/AGORAGENTIC_WORKFLOWS.md\`
- \`docs/AGORAGENTIC_SAFETY_BOUNDARIES.md\`
- \`agent.json\`
- \`.env.example\`
- \`.github/workflows/agoragentic-premortem-golden-loop.yml\`

It does not overwrite existing files.

The \`audit\` command may also write local report and handoff artifacts under \`.agoragentic/premortem-golden-loop/\`, including \`audit-guide.html\`, \`audit-summary.md\`, \`ide-fix-prompt.md\`, and \`agent-handoff.md\`.

## What Self-Heal Will Not Do

- It will not edit application source code.
- It will not delete files.
- It will not overwrite existing files.
- It will not remove secrets automatically.
- It will not rotate credentials.
- It will not install dependencies without the user's own package manager command.
- It will not run paid \`execute()\` calls.
- It will not transfer USDC or sign wallet payments.
- It will not publish to Agent OS, a marketplace, npm, PyPI, or GitHub.

## Optional Network Canaries

\`--allow-network-canaries\` calls only public no-spend Agoragentic endpoints and sends no repo content. Keep it off for fully offline runs.
`;
}

function renderEnvExample() {
  return `# Agoragentic Premortem Golden Loop defaults
AGORAGENTIC_NO_SPEND=1
AGORAGENTIC_ALLOW_REAL_SPEND=0
AGORAGENTIC_ALLOW_NETWORK_CANARIES=0

# Optional only if this repo later uses hosted Agent OS APIs.
AGORAGENTIC_API_KEY=amk_your_key
`;
}

function renderGithubWorkflow() {
  return `name: Agoragentic Premortem Golden Loop

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  local-readiness:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      AGORAGENTIC_NO_SPEND: "1"
      AGORAGENTIC_ALLOW_REAL_SPEND: "0"
      AGORAGENTIC_ALLOW_NETWORK_CANARIES: "0"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run local no-spend readiness
        run: npx --yes agoragentic-premortem-golden-loop audit --repo . --ci --skip-network
`;
}

export function renderHealingPlanMarkdown(report) {
  const lines = [
    '# Agoragentic Self-Heal Plan',
    '',
    `Generated: ${report.generated_at}`,
    `Repository: ${report.root}`,
    `Mode: ${report.mode}`,
    '',
    '## Privacy Boundary',
    '',
    '- Free to use',
    '- No API key required',
    '- No network calls in heal mode',
    '- No repo contents uploaded',
    '- No paid execution or wallet action',
    '',
    '## Proposed Safe Fixes',
    '',
    '| Action | Target | Status | Reason |',
    '|---|---|---|---|'
  ];

  for (const action of report.plan.actions) {
    lines.push(`| ${escapeMd(action.title)} | ${escapeMd(action.target)} | ${action.type} | ${escapeMd(action.reason)} |`);
  }

  lines.push('', '## Manual Actions', '');
  if (!report.plan.manual.length) {
    lines.push('- None.');
  } else {
    for (const item of report.plan.manual) lines.push(`- ${item.title}: ${item.action}`);
  }

  if (report.applied.length) {
    lines.push('', '## Applied', '');
    for (const item of report.applied) lines.push(`- ${item.status}: ${item.target}`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderClosureLoopMarkdown(closure) {
  const summary = closure.summary || summarizeClosure(closure.items || []);
  const lines = [
    '# Agoragentic Closure Loop',
    '',
    `Generated: ${closure.generated_at}`,
    `Repository: ${closure.root}`,
    `Current receipt: ${closure.current_receipt_id}`,
    `Previous receipt: ${closure.previous_receipt_id || 'none'}`,
    '',
    '## Summary',
    '',
    `- Closed: ${summary.closed}`,
    `- Applied this run: ${summary.applied_this_run}`,
    `- Verified resolved: ${summary.verified_resolved}`,
    `- Verified present: ${summary.verified_present}`,
    `- Still open: ${summary.still_open}`,
    `- Blocked: ${summary.blocked}`,
    '',
    '## Fix Closure Table',
    '',
    '| Status | Type | Item | Evidence |',
    '|---|---|---|---|'
  ];

  if (!closure.items?.length) {
    lines.push('| clear | none | No recommended fixes are open | Keep the local receipt with the release artifacts |');
  } else {
    for (const item of closure.items) {
      lines.push(`| ${escapeMd(item.status)} | ${escapeMd(item.type)} | ${escapeMd(itemLabel(item))} | ${escapeMd((item.evidence || []).join('; '))} |`);
    }
  }

  lines.push('', '## How To Close The Loop', '');
  for (const step of closure.how_to_close_loop || []) lines.push(`- ${step}`);
  lines.push('', 'Boundary: local-only comparison of current repo state and prior local audit artifacts. No network calls, no repository upload, no deletes, no source rewrites, and no paid execution.', '');
  return `${lines.join('\n')}\n`;
}

export async function runPremortemSession(options = {}) {
  const root = normalizeRoot(options.repo || options.root || '.');
  const generatedAt = nowIso();
  const timestamp = timestampSlug(generatedAt);
  const context = await buildPremortemContext({ ...options, root });

  if (!context.sufficient) {
    return {
      schema: 'agoragentic.premortem-session.v1',
      generated_at: generatedAt,
      timestamp,
      status: 'needs_context',
      root,
      context,
      question: nextContextQuestion(context.missing),
      no_spend: true
    };
  }

  const frame = `It is 6 months from now. ${context.what} has failed. It is done. We are looking back and trying to understand what went wrong.`;
  const failureReasons = generateFailureReasons(context);
  const deepDives = await Promise.all(
    failureReasons.map((reason, index) => analyzeFailureReason(context, reason, index))
  );
  const synthesis = synthesizePremortem(context, failureReasons, deepDives);

  return {
    schema: 'agoragentic.premortem-session.v1',
    generated_at: generatedAt,
    timestamp,
    status: 'complete',
    root,
    context,
    frame,
    failure_reasons: failureReasons,
    investigator_pass: {
      mode: 'local_parallel_investigator_pass',
      agent_count: deepDives.length,
      note: 'Each failure reason is analyzed independently through the same investigator contract. Hosted or model-backed runners can replace this deterministic pass with parallel sub-agents.'
    },
    deep_dives: deepDives,
    synthesis,
    no_spend: true,
    boundary: {
      credentials_required: false,
      paid_execution: false,
      production_mutation: false
    }
  };
}

async function buildPremortemContext(options) {
  const root = options.root;
  const planFileText = options.planFile ? await readText(path.resolve(root, options.planFile)).catch(() => '') : '';
  const explicitPlan = String(options.plan || '').trim();
  const workspace = await collectWorkspaceContext(root);
  const combined = [explicitPlan, planFileText, workspace.map((item) => item.excerpt).join('\n')].filter(Boolean).join('\n\n');
  const what = explicitPlan || firstNonEmptyLine(planFileText) || inferWhat(combined);
  const who = String(options.audience || '').trim() || inferAudience(combined);
  const success = String(options.success || '').trim() || inferSuccess(combined);
  const missing = [];
  if (!what) missing.push('what');
  if (!who) missing.push('who');
  if (!success) missing.push('success');

  return {
    what,
    who,
    success,
    plan_text: combined.trim(),
    workspace_context: workspace,
    sufficient: missing.length === 0,
    missing
  };
}

async function collectWorkspaceContext(root) {
  const preferred = [
    'CLAUDE.md',
    'claude.md',
    'AGENTS.md',
    'README.md',
    'START_HERE.md'
  ];
  const snippets = [];

  for (const rel of preferred) {
    const full = path.join(root, rel);
    if (await exists(full)) {
      const text = await readText(full).catch(() => '');
      if (text.trim()) snippets.push({ file: slash(rel), excerpt: excerpt(text, 1800) });
    }
  }

  const files = await walkFiles(root, { maxFiles: 800 });
  const candidates = files
    .map((file) => relative(root, file))
    .filter((rel) => /(^|\/)(memory|docs|plans?|briefs?|strategy|launch|prd)(\/|$)|premortem|plan|brief|strategy|launch|product|roadmap/i.test(rel))
    .filter((rel) => TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase()))
    .slice(0, 8);

  for (const rel of candidates) {
    if (snippets.some((item) => item.file.toLowerCase() === rel.toLowerCase())) continue;
    const full = path.join(root, rel);
    const stat = await statSafe(full);
    if (!stat || stat.size > 250_000) continue;
    const text = await readText(full).catch(() => '');
    if (text.trim()) snippets.push({ file: slash(rel), excerpt: excerpt(text, 1200) });
    if (snippets.length >= 10) break;
  }

  return snippets;
}

function firstNonEmptyLine(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function excerpt(text, maxChars) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function inferWhat(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const useful = lines.find((line) => /launch|build|release|ship|plan|strategy|product|agent|repo|workshop|pricing|hire/i.test(line));
  return useful ? useful.replace(/^#+\s*/, '').slice(0, 220) : '';
}

function inferAudience(text) {
  const source = String(text || '');
  const patterns = [
    /\btarget(?:ing)?\s+([^.\n]{8,120})/i,
    /\bfor\s+([^.\n]{8,120})/i,
    /\baudience\s*[:=-]\s*([^.\n]{8,120})/i,
    /\bcustomer(?:s)?\s*[:=-]\s*([^.\n]{8,120})/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return cleanInference(match[1]);
  }
  return '';
}

function inferSuccess(text) {
  const source = String(text || '');
  const patterns = [
    /\bsuccess(?:\s+looks\s+like)?\s*[:=-]\s*([^.\n]{8,160})/i,
    /\bwin(?:\s+looks\s+like)?\s*[:=-]\s*([^.\n]{8,160})/i,
    /\bgoal\s*[:=-]\s*([^.\n]{8,160})/i,
    /\bso that\s+([^.\n]{8,160})/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return cleanInference(match[1]);
  }
  return '';
}

function cleanInference(value) {
  return String(value || '').replace(/[`*_#]/g, '').trim().slice(0, 180);
}

function nextContextQuestion(missing) {
  if (missing.includes('what')) return 'What specifically are you about to launch, build, decide, or release?';
  if (missing.includes('who')) return 'Who is this for, and who will be affected if it fails?';
  if (missing.includes('success')) return 'What does a win look like for this?';
  return 'What context should this premortem use?';
}

function generateFailureReasons(context) {
  const text = `${context.what}\n${context.who}\n${context.success}\n${context.plan_text}`.toLowerCase();
  const candidates = [
    {
      id: 'audience-mismatch',
      reason: `${context.who} did not behave like the plan assumed, so the offer landed with people adjacent to the target user instead of the people who could make ${context.success} happen.`,
      assumption: `The target audience is reachable, self-identifies with this problem, and has enough urgency to act now.`,
      warning_signs: ['Interested replies come from adjacent users who are not the intended buyer or operator.', 'People praise the idea but cannot name when they would install, buy, or use it.'],
      revision: 'Run a small target-user pilot first and only scale the release once the actual buyers match the intended audience.',
      likelihood: 5,
      severity: 4
    },
    {
      id: 'distribution-gap',
      reason: `The release shipped, but the distribution plan was too passive; a GitHub repo or launch post did not create repeated qualified installs from ${context.who}.`,
      assumption: `Publishing the artifact is close enough to distribution.`,
      warning_signs: ['Stars or likes arrive without installs, issues, forks, receipts, or repeat runs.', 'Most traffic comes from one launch spike and disappears inside two weeks.'],
      revision: 'Define three repeatable distribution loops before launch: one community channel, one partner/user workflow, and one machine-readable discovery path.',
      likelihood: 4,
      severity: 4
    },
    {
      id: 'onboarding-friction',
      reason: `People installed it and stalled before the first successful run because setup, context gathering, or output expectations were not obvious enough for a fresh repo owner.`,
      assumption: `A motivated user will debug the setup path and infer the intended workflow.`,
      warning_signs: ['Issues ask basic install or first-run questions already covered in the README.', 'Users run the CLI once but no generated report or receipt appears.'],
      revision: 'Make the first-run path one command, no credentials by default, with a sample fixture and expected output committed in docs.',
      likelihood: text.includes('repo') || text.includes('install') || text.includes('github') ? 5 : 3,
      severity: 4
    },
    {
      id: 'proof-gap',
      reason: `The Golden Loop claim was not credible to users because the local report looked like analysis, not proof that the agent could install, run, produce receipts, and stay inside a no-spend boundary.`,
      assumption: `Users will trust the workflow without a concrete artifact trail.`,
      warning_signs: ['Users ask whether the report is just generated text.', 'Maintainers cannot point to a receipt, transcript, or reproducible check for a specific release.'],
      revision: 'Treat the local receipt, transcript, and no-spend canary output as release artifacts and publish them with every tagged release.',
      likelihood: text.includes('golden loop') || text.includes('receipt') || text.includes('agent') ? 5 : 3,
      severity: 5
    },
    {
      id: 'scope-sprawl',
      reason: `The project tried to be a premortem agent, release auditor, Golden Loop tester, and launch package at once, so none of the workflows felt sharp enough to become habitual.`,
      assumption: `More adjacent safety features will make the product clearer instead of harder to understand.`,
      warning_signs: ['The README keeps growing but the primary command is still hard to explain in one sentence.', 'Users ask which mode they are supposed to run first.'],
      revision: 'Separate the public story into two commands: decision premortem for plans, and Golden Loop readiness for installable agent repos.',
      likelihood: text.includes('premortem') && text.includes('golden loop') ? 5 : 3,
      severity: 3
    },
    {
      id: 'trust-safety',
      reason: `The agent scared off serious users because it touched repo files, scanned secrets, or discussed paid execution without making the authority boundary unmistakable.`,
      assumption: `Users will read the safety notes before deciding whether to run it.`,
      warning_signs: ['Security-minded users ask what leaves their machine.', 'People avoid running it on real repos until someone audits the behavior.'],
      revision: 'Keep no-spend/no-network defaults visible in the command output and document exactly what is read, written, and never transmitted.',
      likelihood: text.includes('secret') || text.includes('paid') || text.includes('wallet') || text.includes('usdc') ? 4 : 3,
      severity: 5
    },
    {
      id: 'maintenance-drag',
      reason: `After the launch, the agent became a maintenance surface without a clear owner: prompts drifted, report quality varied, and compatibility issues accumulated faster than usage proof.`,
      assumption: `The first release will be stable enough that maintenance can wait.`,
      warning_signs: ['Small issues linger for more than a week.', 'Prompt updates happen without tests that prove the output shape still works.'],
      revision: 'Add output-shape tests, fixture premortems, and a release checklist before inviting broad public usage.',
      likelihood: 3,
      severity: 4
    },
    {
      id: 'success-metric-drift',
      reason: `The team celebrated visible activity while missing ${context.success}, so the project looked alive while failing its actual purpose.`,
      assumption: `Early attention is a reliable proxy for the outcome that matters.`,
      warning_signs: ['The dashboard tracks stars, posts, or comments but not completed runs and acted-on revisions.', 'Users read reports but do not change their plans.'],
      revision: 'Define success as completed premortems with at least one concrete plan revision, not impressions or repository stars.',
      likelihood: 4,
      severity: 4
    }
  ];

  const selected = candidates
    .filter((item) => {
      if (['audience-mismatch', 'distribution-gap', 'success-metric-drift'].includes(item.id)) return true;
      if (item.id === 'onboarding-friction') return /repo|install|github|cli|agent|oss|open source/.test(text);
      if (item.id === 'proof-gap') return /golden loop|receipt|proof|agent|test/.test(text);
      if (item.id === 'scope-sprawl') return /premortem|golden loop|agent|oss/.test(text);
      if (item.id === 'trust-safety') return /secret|paid|wallet|usdc|api key|repo|agent/.test(text);
      if (item.id === 'maintenance-drag') return /oss|open source|github|repo|package|agent/.test(text);
      return false;
    })
    .slice(0, 8);

  return selected.map((item, index) => ({
    ...item,
    rank: index + 1,
    accent: ['#7dd3fc', '#fca5a5', '#c4b5fd', '#86efac', '#fcd34d', '#f9a8d4', '#93c5fd', '#fdba74'][index % 8]
  }));
}

async function analyzeFailureReason(context, reason, index) {
  const moments = [
    `At launch, the team framed ${context.what} around the intended outcome: ${context.success}. The first signal looked encouraging, but the behavior underneath did not match the plan.`,
    `${context.who} hit the exact weak point: ${reason.reason} The team adjusted messaging and docs after the fact, but by then the first cohort had already formed the wrong impression.`,
    `By month six, the failure was no longer a single bug or missed announcement. It was a pattern: the plan depended on "${reason.assumption}", and the evidence kept saying that assumption was false.`
  ];

  return {
    id: reason.id,
    agent_id: `investigator-${String(index + 1).padStart(2, '0')}`,
    failure_reason: reason.reason,
    likelihood: reason.likelihood,
    severity: reason.severity,
    failure_story: `${moments[0]}\n\n${moments[1]} ${moments[2]}`,
    underlying_assumption: reason.assumption,
    early_warning_signs: reason.warning_signs,
    concrete_revision: reason.revision,
    accent: reason.accent
  };
}

function synthesizePremortem(context, reasons, deepDives) {
  const mostLikely = [...deepDives].sort((a, b) => b.likelihood - a.likelihood || b.severity - a.severity)[0];
  const mostDangerous = [...deepDives].sort((a, b) => b.severity - a.severity || b.likelihood - a.likelihood)[0];
  const hiddenAssumption = `The hidden assumption is that ${context.who} will understand the value, trust the boundary, complete the first run, and convert the output into action without a tighter launch loop proving each step.`;
  const revisedPlan = deepDives
    .slice()
    .sort((a, b) => (b.likelihood + b.severity) - (a.likelihood + a.severity))
    .slice(0, 6)
    .map((item) => ({
      failure_id: item.id,
      change: item.concrete_revision
    }));
  const checklist = [
    `Describe the target user and success metric in one sentence: "${context.who}" and "${context.success}".`,
    'Run one end-to-end first-use test from a clean checkout and preserve the generated receipt.',
    'Publish the no-spend boundary beside the install command, including what is read, written, and never transmitted.',
    'Test distribution with at least five real target users before treating public launch attention as validation.',
    'Require every release to include a premortem transcript, report, and one concrete plan revision.'
  ];

  return {
    most_likely_failure: {
      id: mostLikely.id,
      title: mostLikely.failure_reason,
      why: `It has the highest likelihood because it can happen even if the build succeeds: the intended users simply do not behave the way the plan needs them to.`
    },
    most_dangerous_failure: {
      id: mostDangerous.id,
      title: mostDangerous.failure_reason,
      why: `It is the most damaging because it undermines trust in the whole release, not just one feature or launch channel.`
    },
    hidden_assumption: hiddenAssumption,
    revised_plan: revisedPlan,
    pre_launch_checklist: checklist,
    chat_summary: [
      `Most likely failure: ${mostLikely.failure_reason}`,
      `Hidden assumption: ${hiddenAssumption}`,
      `Most important revision: ${revisedPlan[0]?.change || 'Run a narrow pilot before the public release.'}`
    ]
  };
}

export function renderPremortemSessionHtml(session) {
  const cards = session.deep_dives.map((item) => `
    <article class="card" style="--accent:${escapeHtml(item.accent)}">
      <div class="card-top">
        <span>${escapeHtml(item.agent_id)}</span>
        <span>L${item.likelihood} / S${item.severity}</span>
      </div>
      <h3>${escapeHtml(item.failure_reason)}</h3>
      <p>${escapeHtml(item.failure_story).replace(/\n\n/g, '</p><p>')}</p>
      <div class="minor"><strong>Underlying assumption:</strong> ${escapeHtml(item.underlying_assumption)}</div>
      <ul>${item.early_warning_signs.map((sign) => `<li>${escapeHtml(sign)}</li>`).join('')}</ul>
    </article>
  `).join('\n');

  const revisions = session.synthesis.revised_plan.map((item) => `<li><strong>${escapeHtml(item.failure_id)}:</strong> ${escapeHtml(item.change)}</li>`).join('');
  const checklist = session.synthesis.pre_launch_checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Premortem Report</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0a0e1a; color: #e5ecff; }
    main { max-width: 1180px; margin: 0 auto; padding: 40px 20px 56px; }
    h1, h2, h3 { margin: 0; line-height: 1.1; letter-spacing: 0; }
    h1 { font-size: clamp(32px, 5vw, 58px); max-width: 920px; }
    h2 { font-size: 22px; margin-bottom: 14px; }
    h3 { font-size: 18px; margin: 14px 0 10px; }
    p, li { color: #c9d4ef; line-height: 1.55; }
    .eyebrow { color: #7dd3fc; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; font-weight: 700; }
    .hero { border-bottom: 1px solid #22304f; padding-bottom: 28px; margin-bottom: 28px; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .pill { border: 1px solid #2d3c61; border-radius: 999px; padding: 8px 12px; color: #b8c5e6; background: #11182a; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .panel, .card { background: #101827; border: 1px solid #24304e; border-radius: 8px; padding: 18px; }
    .panel strong { color: #ffffff; }
    .synthesis { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 28px; }
    .wide { grid-column: 1 / -1; }
    .card { border-top: 4px solid var(--accent); }
    .card-top { display: flex; justify-content: space-between; gap: 12px; color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .minor { border-left: 3px solid var(--accent); padding-left: 12px; color: #dbe6ff; margin: 14px 0; }
    footer { margin-top: 34px; color: #7f8cad; font-size: 13px; }
    @media (max-width: 860px) { .grid, .synthesis { grid-template-columns: 1fr; } main { padding: 28px 14px 40px; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">Premortem Report</div>
      <h1>${escapeHtml(session.context.what)}</h1>
      <div class="meta">
        <span class="pill">${escapeHtml(session.generated_at)}</span>
        <span class="pill">${session.investigator_pass.agent_count} investigators</span>
        <span class="pill">No-spend local analysis</span>
      </div>
    </section>

    <section class="grid synthesis">
      <div class="panel"><h2>Most Likely Failure</h2><p><strong>${escapeHtml(session.synthesis.most_likely_failure.title)}</strong></p><p>${escapeHtml(session.synthesis.most_likely_failure.why)}</p></div>
      <div class="panel"><h2>Most Dangerous Failure</h2><p><strong>${escapeHtml(session.synthesis.most_dangerous_failure.title)}</strong></p><p>${escapeHtml(session.synthesis.most_dangerous_failure.why)}</p></div>
      <div class="panel wide"><h2>Hidden Assumption</h2><p>${escapeHtml(session.synthesis.hidden_assumption)}</p></div>
      <div class="panel"><h2>Revised Plan</h2><ol>${revisions}</ol></div>
      <div class="panel"><h2>Pre-Launch Checklist</h2><ol>${checklist}</ol></div>
    </section>

    <section>
      <h2>Investigator Findings</h2>
      <div class="grid">${cards}</div>
    </section>

    <footer>Premortem generated for ${escapeHtml(session.context.what)}. Audience: ${escapeHtml(session.context.who)}. Success: ${escapeHtml(session.context.success)}.</footer>
  </main>
</body>
</html>
`;
}

export function renderPremortemSessionTranscript(session) {
  const lines = [
    '# Premortem Transcript',
    '',
    `Generated: ${session.generated_at}`,
    '',
    '## Context',
    '',
    `What: ${session.context.what}`,
    `Who: ${session.context.who}`,
    `Success: ${session.context.success}`,
    '',
    '## Frame',
    '',
    session.frame,
    '',
    '## Raw Failure Reasons',
    ''
  ];

  for (const reason of session.failure_reasons) {
    lines.push(`${reason.rank}. ${reason.reason}`);
  }

  lines.push('', '## Deep Dives', '');
  for (const dive of session.deep_dives) {
    lines.push(`### ${dive.agent_id}: ${dive.failure_reason}`, '');
    lines.push('Failure story:', '', dive.failure_story, '');
    lines.push(`Underlying assumption: ${dive.underlying_assumption}`, '');
    lines.push('Early warning signs:');
    for (const sign of dive.early_warning_signs) lines.push(`- ${sign}`);
    lines.push('');
  }

  lines.push('## Synthesis', '');
  lines.push(`Most likely failure: ${session.synthesis.most_likely_failure.title}`);
  lines.push(`Why: ${session.synthesis.most_likely_failure.why}`, '');
  lines.push(`Most dangerous failure: ${session.synthesis.most_dangerous_failure.title}`);
  lines.push(`Why: ${session.synthesis.most_dangerous_failure.why}`, '');
  lines.push(`Hidden assumption: ${session.synthesis.hidden_assumption}`, '');
  lines.push('Revised plan:');
  for (const item of session.synthesis.revised_plan) lines.push(`- ${item.change}`);
  lines.push('', 'Pre-launch checklist:');
  for (const item of session.synthesis.pre_launch_checklist) lines.push(`- ${item}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderPremortemSessionSummary(session) {
  return session.synthesis.chat_summary.join(' ');
}

export function premortemSessionFileNames(timestamp) {
  return {
    report: `premortem-report-${timestamp}.html`,
    transcript: `premortem-transcript-${timestamp}.md`,
    json: `premortem-session-${timestamp}.json`
  };
}

export function buildLocalReceipt({ root, premortem, goldenLoop }) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({
      root: slash(root),
      premortem: premortem.summary,
      golden_loop: goldenLoop.summary,
      repo_fingerprint: premortem.repo_fingerprint
    }))
    .digest('hex');

  return {
    schema: 'agoragentic.premortem-golden-loop.local-receipt.v1',
    receipt_id: `pgl_${digest.slice(0, 16)}`,
    generated_at: nowIso(),
    root,
    repo_fingerprint: premortem.repo_fingerprint || null,
    premortem_summary: premortem.summary,
    golden_loop_summary: goldenLoop.summary,
    pass: premortem.summary.blockers === 0 && goldenLoop.summary.fail === 0,
    no_spend: true,
    boundary: {
      free_to_use: true,
      network_calls: false,
      repo_contents_uploaded: false,
      credentials_required: false,
      paid_execution: false,
      production_mutation: false,
      real_usdc_transfer: false,
      agoragentic_api_key_required: false
    }
  };
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

export async function writeAuditArtifacts(outDir, audit) {
  const guidePath = path.join(outDir, 'audit-guide.html');
  const idePromptPath = path.join(outDir, 'ide-fix-prompt.md');
  const agentHandoffPath = path.join(outDir, 'agent-handoff.md');
  const previousAudit = await readJson(path.join(outDir, 'audit.json'));

  audit.closure_loop = await buildClosureLoop(audit, previousAudit);
  audit.handoff = buildIdeHandoff(audit);
  audit.launch_gate = buildLaunchGate(audit);

  await writeJson(path.join(outDir, 'audit.json'), audit);
  await writeText(path.join(outDir, 'audit-summary.md'), renderAuditSummaryMarkdown(audit));
  await writeText(guidePath, renderAuditGuideHtml(audit));
  await writeText(idePromptPath, renderIdeFixPrompt(audit, 'local IDE agent'));
  await writeText(agentHandoffPath, renderIdeFixPrompt(audit, 'local coding agent'));
  await writeJson(path.join(outDir, 'doctor.json'), audit.doctor);
  await writeText(path.join(outDir, 'doctor.md'), renderDoctorMarkdown(audit.doctor));
  await writeJson(path.join(outDir, 'premortem.json'), audit.effective_audit.premortem);
  await writeText(path.join(outDir, 'premortem.md'), renderPremortemMarkdown(audit.effective_audit.premortem));
  await writeJson(path.join(outDir, 'golden-loop.json'), audit.effective_audit.golden_loop);
  await writeText(path.join(outDir, 'golden-loop.md'), renderGoldenLoopMarkdown(audit.effective_audit.golden_loop));
  await writeJson(path.join(outDir, 'local-receipt.json'), audit.effective_audit.receipt);
  await writeText(path.join(outDir, 'summary.md'), renderSummaryMarkdown(audit.effective_audit));
  await writeJson(path.join(outDir, 'healing-plan.json'), audit.healing);
  await writeText(path.join(outDir, 'healing-plan.md'), renderHealingPlanMarkdown(audit.healing));
  await writeJson(path.join(outDir, 'closure-loop.json'), audit.closure_loop);
  await writeText(path.join(outDir, 'closure-loop.md'), renderClosureLoopMarkdown(audit.closure_loop));
  if (audit.healing.after) {
    await writeJson(path.join(outDir, 'healing-recheck.json'), audit.healing.after);
  }

  if (audit.premortem_session.status === 'complete') {
    const names = premortemSessionFileNames(audit.premortem_session.timestamp);
    await writeJson(path.join(outDir, names.json), audit.premortem_session);
    await writeText(path.join(outDir, names.report), renderPremortemSessionHtml(audit.premortem_session));
    await writeText(path.join(outDir, names.transcript), renderPremortemSessionTranscript(audit.premortem_session));
  } else {
    await writeJson(path.join(outDir, 'premortem-context-needed.json'), audit.premortem_session);
  }

  return {
    out_dir: outDir,
    audit_json: path.join(outDir, 'audit.json'),
    audit_guide: guidePath,
    audit_summary: path.join(outDir, 'audit-summary.md'),
    closure_loop: path.join(outDir, 'closure-loop.json'),
    closure_loop_summary: path.join(outDir, 'closure-loop.md'),
    ide_fix_prompt: idePromptPath,
    agent_handoff: agentHandoffPath,
    local_receipt: path.join(outDir, 'local-receipt.json')
  };
}

export function renderPremortemMarkdown(report) {
  const lines = [
    '# Agoragentic Premortem',
    '',
    `Generated: ${report.generated_at}`,
    `Repository: ${report.root}`,
    `Score: ${report.summary.score}`,
    `Blockers: ${report.summary.blockers}`,
    `Warnings: ${report.summary.warnings}`,
    '',
    '## Risks',
    '',
    '| Severity | Risk | Evidence | Action |',
    '|---|---|---|---|'
  ];

  if (!report.risks.length) {
    lines.push('| pass | No release blockers found | Premortem checks passed | Keep the receipt with the release artifacts |');
  } else {
    for (const risk of report.risks) {
      lines.push(`| ${risk.severity} | ${escapeMd(risk.title)} | ${escapeMd((risk.evidence || []).join('; '))} | ${escapeMd(risk.action)} |`);
    }
  }

  lines.push('', '## Next Actions', '');
  if (!report.next_actions.length) {
    lines.push('- Keep the generated receipt with the release artifacts.');
  } else {
    for (const item of report.next_actions) {
      lines.push(`- [${item.severity}] ${item.action}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderGoldenLoopMarkdown(report) {
  const lines = [
    '# Agoragentic No-Spend Golden Loop',
    '',
    `Generated: ${report.generated_at}`,
    `Repository: ${report.root}`,
    `Pass: ${report.pass ? 'yes' : 'no'}`,
    '',
    '| Stage | Status | Evidence |',
    '|---|---|---|'
  ];

  for (const item of report.stages) {
    lines.push(`| ${escapeMd(item.title)} | ${item.status} | ${escapeMd((item.evidence || []).join('; '))} |`);
  }

  lines.push('', 'Boundary: no credentials, no paid execution, no production mutation, no real USDC transfer.', '');
  return `${lines.join('\n')}\n`;
}

export function renderSummaryMarkdown(run) {
  const receipt = run.receipt;
  return [
    '# Premortem Golden Loop Receipt',
    '',
    `Receipt: ${receipt.receipt_id}`,
    `Generated: ${receipt.generated_at}`,
    `Pass: ${receipt.pass ? 'yes' : 'no'}`,
    `Premortem score: ${receipt.premortem_summary.score}`,
    `Golden Loop failures: ${receipt.golden_loop_summary.fail}`,
    '',
    'This is a local no-spend receipt. It does not prove paid settlement, hosted deployment, or seller earnings.',
    ''
  ].join('\n');
}

export function renderDoctorMarkdown(doctor) {
  const lines = [
    '# Agoragentic Premortem Golden Loop Doctor',
    '',
    `Generated: ${doctor.generated_at}`,
    `Repository: ${doctor.root}`,
    `Status: ${doctor.status}`,
    '',
    doctor.summary,
    '',
    '## What It Does',
    ''
  ];
  for (const item of doctor.what_it_does) lines.push(`- ${item}`);
  lines.push('', '## Reads', '');
  for (const item of doctor.reads) lines.push(`- ${item}`);
  lines.push('', '## Writes', '');
  for (const item of doctor.writes) lines.push(`- ${item}`);
  lines.push('', '## Never', '');
  for (const item of doctor.never) lines.push(`- ${item}`);
  lines.push('', '## Recommended Commands', '');
  for (const command of doctor.recommended_commands) lines.push(`\`${command}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderAuditSummaryMarkdown(audit) {
  const effective = audit.effective_audit;
  const lines = [
    '# Agoragentic Audit Summary',
    '',
    `Generated: ${audit.generated_at}`,
    `Repository: ${audit.root}`,
    `Status: ${audit.status}`,
    `Receipt: ${effective.receipt.receipt_id}`,
    `Premortem score: ${effective.premortem.summary.score}`,
    `Premortem blockers: ${effective.premortem.summary.blockers}`,
    `Premortem warnings: ${effective.premortem.summary.warnings}`,
    `Golden Loop pass: ${effective.golden_loop.pass ? 'yes' : 'no'}`,
    `Golden Loop failures: ${effective.golden_loop.summary.fail}`,
    '',
    '## Boundary',
    '',
    '- Local by default',
    '- Free to use',
    '- No repository contents uploaded by default',
    '- No paid execution, wallet signing, deployment, publishing, deletion, or overwrite',
    '- Safe fixes create missing scaffolds only when `--apply-safe-fixes` is passed',
    '',
    '## Closure Loop',
    '',
    `Previous audit found: ${audit.closure_loop?.previous_audit_found ? 'yes' : 'no'}`,
    `Closed recommendations: ${audit.closure_loop?.summary?.closed ?? 0}`,
    `Applied this run: ${audit.closure_loop?.summary?.applied_this_run ?? 0}`,
    `Still open: ${audit.closure_loop?.summary?.still_open ?? 0}`,
    '',
    'See `closure-loop.md` and `closure-loop.json` for the full local fix-tracking ledger.',
    '',
    '## Premortem Session',
    ''
  ];

  if (audit.premortem_session.status === 'complete') {
    lines.push(`Most likely failure: ${audit.premortem_session.synthesis.most_likely_failure.title}`);
    lines.push(`Hidden assumption: ${audit.premortem_session.synthesis.hidden_assumption}`);
  } else {
    lines.push(`Context needed: ${audit.premortem_session.question}`);
  }

  lines.push('', '## Golden Loop Stages', '');
  for (const stageItem of effective.golden_loop.stages) {
    lines.push(`- [${stageItem.status}] ${stageItem.title}: ${(stageItem.evidence || []).join('; ')}`);
  }

  lines.push('', '## Recommended Fixes', '');
  if (!audit.handoff.next_actions.length && !audit.handoff.safe_additive_implementations.length) {
    lines.push('- No release blockers found. Keep the local receipt with the release artifacts.');
  } else {
    for (const item of audit.handoff.next_actions) lines.push(`- [${item.severity}] ${item.action}`);
    for (const item of audit.handoff.safe_additive_implementations) lines.push(`- [safe-create] ${item.target}: ${item.reason}`);
  }

  lines.push('', '## IDE / Agent Handoff', '');
  lines.push('Use `ide-fix-prompt.md` or `agent-handoff.md` with a local IDE agent. The handoff repeats the safety boundaries and current findings.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderIdeFixPrompt(audit, audience = 'local IDE agent') {
  const handoff = audit.handoff;
  const lines = [
    `# Agoragentic Handoff For ${audience}`,
    '',
    'You are helping improve this repository based on a local Agoragentic Premortem Golden Loop audit.',
    '',
    '## Non-Negotiable Boundaries',
    ''
  ];
  for (const item of handoff.guardrails) lines.push(`- ${item}`);

  lines.push('', '## Current Findings', '');
  lines.push(`- Audit status: ${handoff.current_findings.status}`);
  lines.push(`- Premortem score: ${handoff.current_findings.premortem_score}`);
  lines.push(`- Blockers: ${handoff.current_findings.blockers}`);
  lines.push(`- Warnings: ${handoff.current_findings.warnings}`);
  lines.push(`- Golden Loop failures: ${handoff.current_findings.golden_loop_failures}`);
  lines.push(`- Golden Loop warnings: ${handoff.current_findings.golden_loop_warnings}`);
  lines.push(`- Premortem context status: ${handoff.current_findings.premortem_context_status}`);

  if (audit.closure_loop) {
    lines.push('', '## Closure Loop', '');
    lines.push(`- Previous audit found: ${audit.closure_loop.previous_audit_found ? 'yes' : 'no'}`);
    lines.push(`- Closed recommendations: ${audit.closure_loop.summary.closed}`);
    lines.push(`- Applied this run: ${audit.closure_loop.summary.applied_this_run}`);
    lines.push(`- Still open: ${audit.closure_loop.summary.still_open}`);
    lines.push('- Read `closure-loop.md` before claiming a recommendation is fixed.');
  }

  lines.push('', '## Read These Local Artifacts First', '');
  for (const file of handoff.files_to_read_first) lines.push(`- ${file}`);

  lines.push('', '## Next Actions From Audit', '');
  if (!handoff.next_actions.length) lines.push('- No blocker actions were generated.');
  for (const item of handoff.next_actions) lines.push(`- [${item.severity}] ${item.action}`);

  lines.push('', '## Safe Additive Implementations Available', '');
  if (!handoff.safe_additive_implementations.length) {
    lines.push('- No missing scaffold files were proposed.');
  } else {
    for (const item of handoff.safe_additive_implementations) {
      lines.push(`- ${item.target}: ${item.reason}`);
    }
    lines.push('');
    lines.push('Owner-approved command to apply only those missing scaffolds:');
    lines.push('');
    lines.push('```bash');
    lines.push('npx agoragentic-premortem-golden-loop audit --repo . --apply-safe-fixes');
    lines.push('```');
  }

  lines.push('', '## Manual Owner Actions', '');
  if (!handoff.manual_owner_actions.length) {
    lines.push('- None currently required.');
  } else {
    for (const item of handoff.manual_owner_actions) lines.push(`- ${item.title}: ${item.action}`);
  }

  lines.push('', '## Completion Standard', '');
  for (const item of handoff.suggested_sequence) lines.push(`- ${item}`);
  lines.push('');
  lines.push('Rerun when done:');
  lines.push('');
  lines.push('```bash');
  lines.push(handoff.rerun_command);
  lines.push('```');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderAuditGuideHtml(audit) {
  const effective = audit.effective_audit;
  const launchGate = audit.launch_gate || buildLaunchGate(audit);
  const sourceFileList = launchGate.source_files_read.files.length
    ? launchGate.source_files_read.files.slice(0, 24).map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('')
    : '<li>No source files were readable from this repository path.</li>';
  const sourceFileNote = launchGate.source_files_read.truncated
    ? '<p class="note">Showing the first 24 files in the HTML guide. The local JSON includes the first 120 file paths.</p>'
    : '<p class="note">Showing local file paths only; file contents are not embedded in this row.</p>';
  const assumptionsRefused = launchGate.assumptions_refused.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const riskyActionsBlocked = launchGate.risky_actions_blocked.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const exactPrompt = escapeHtml(launchGate.ide_prompt_handed_off.exact_prompt);
  const closure = audit.closure_loop || {
    previous_audit_found: false,
    summary: summarizeClosure([]),
    items: []
  };
  const closureItems = closure.items.length
    ? closure.items.slice(0, 12).map((item) => `
      <tr>
        <td><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status.replace(/_/g, ' '))}</span></td>
        <td>${escapeHtml(item.type.replace(/_/g, ' '))}</td>
        <td>${escapeHtml(itemLabel(item))}</td>
        <td>${escapeHtml((item.evidence || []).join('; '))}</td>
      </tr>
    `).join('')
    : '<tr><td><span class="status verified_present">clear</span></td><td>none</td><td>No open recommendations</td><td>Keep the local receipt with the release artifacts.</td></tr>';
  const riskCards = effective.premortem.risks.length
    ? effective.premortem.risks.map((risk) => `
      <article class="card ${escapeHtml(risk.severity)}">
        <div class="kicker">${escapeHtml(risk.severity)}</div>
        <h3>${escapeHtml(risk.title)}</h3>
        <p>${escapeHtml((risk.evidence || []).join('; '))}</p>
        <strong>${escapeHtml(risk.action)}</strong>
      </article>
    `).join('')
    : '<article class="card pass"><div class="kicker">pass</div><h3>No release blockers found</h3><p>Keep the local receipt with the release artifacts.</p></article>';
  const stageCards = effective.golden_loop.stages.map((item) => `
    <article class="card ${escapeHtml(item.status)}">
      <div class="kicker">${escapeHtml(item.status)}</div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml((item.evidence || []).join('; '))}</p>
      ${item.action ? `<strong>${escapeHtml(item.action)}</strong>` : ''}
    </article>
  `).join('');
  const safeFixes = audit.handoff.safe_additive_implementations.length
    ? audit.handoff.safe_additive_implementations.map((item) => `<li><strong>${escapeHtml(item.target)}</strong>: ${escapeHtml(item.reason)}</li>`).join('')
    : '<li>No missing scaffold files proposed.</li>';
  const manual = audit.handoff.manual_owner_actions.length
    ? audit.handoff.manual_owner_actions.map((item) => `<li><strong>${escapeHtml(item.title)}</strong>: ${escapeHtml(item.action)}</li>`).join('')
    : '<li>No manual owner actions currently required.</li>';
  const session = audit.premortem_session.status === 'complete'
    ? `
      <div class="panel">
        <h2>Most Likely Failure</h2>
        <p>${escapeHtml(audit.premortem_session.synthesis.most_likely_failure.title)}</p>
      </div>
      <div class="panel">
        <h2>Hidden Assumption</h2>
        <p>${escapeHtml(audit.premortem_session.synthesis.hidden_assumption)}</p>
      </div>
    `
    : `
      <div class="panel wide">
        <h2>Premortem Context Needed</h2>
        <p>${escapeHtml(audit.premortem_session.question)}</p>
      </div>
    `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agoragentic Audit Guide</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0C1222; color: #E2E8F0; }
    main { max-width: 1180px; margin: 0 auto; padding: 40px 20px 56px; }
    h1, h2, h3 { margin: 0; line-height: 1.1; letter-spacing: 0; }
    h1 { font-size: clamp(32px, 5vw, 58px); max-width: 920px; }
    h2 { font-size: 22px; margin-bottom: 14px; }
    h3 { font-size: 17px; margin: 8px 0 10px; }
    p, li { color: #C9D4EF; line-height: 1.55; }
    strong { color: #F8FAFC; }
    .eyebrow, .kicker { color: #06B6D4; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; font-weight: 700; }
    .hero { border-bottom: 1px solid #263044; padding-bottom: 28px; margin-bottom: 28px; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    .pill { border: 1px solid #3B465C; border-radius: 999px; padding: 8px 12px; color: #CBD5E1; background: #111A2E; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 28px; }
    .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panel, .card { background: #111A2E; border: 1px solid #263044; border-radius: 8px; padding: 18px; }
    .launch-gate { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 28px; }
    .gate-cell { background: #131D30; border: 1px solid #263044; border-radius: 8px; padding: 14px; min-width: 0; }
    .gate-cell h2 { font-size: 16px; margin-bottom: 8px; }
    .gate-cell ul { margin: 10px 0 0; padding-left: 20px; }
    .gate-cell li { font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
    .note { color: #94A3B8; font-size: 12px; margin: 10px 0 0; }
    details { margin-top: 10px; }
    summary { cursor: pointer; color: #06B6D4; font-weight: 700; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #263044; padding: 10px 8px; text-align: left; vertical-align: top; color: #C9D4EF; font-size: 13px; }
    th { color: #E2E8F0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .status { display: inline-block; border-radius: 999px; border: 1px solid #3B465C; padding: 4px 8px; background: #0A1019; color: #E2E8F0; white-space: nowrap; }
    .status.applied_this_run, .status.verified_resolved, .status.verified_present, .status.already_present, .status.skipped_existing { border-color: #22C55E; color: #BBF7D0; }
    .status.open, .status.manual_open { border-color: #F59E0B; color: #FDE68A; }
    .status.blocked { border-color: #E8613A; color: #FEB2A0; }
    pre { max-height: 300px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: #0A1019; border: 1px solid #263044; border-radius: 6px; padding: 12px; color: #E2E8F0; font-size: 12px; line-height: 1.45; }
    .wide { grid-column: 1 / -1; }
    .card { border-top: 4px solid #06B6D4; }
    .card.fail, .card.blocker { border-top-color: #E8613A; }
    .card.warn, .card.warning { border-top-color: #F59E0B; }
    .card.pass { border-top-color: #22C55E; }
    .card.skip, .card.info { border-top-color: #64748B; }
    .boundary { border-left: 4px solid #E8613A; }
    code { color: #E2E8F0; background: #0A1019; border: 1px solid #263044; border-radius: 6px; padding: 2px 6px; }
    footer { margin-top: 34px; color: #94A3B8; font-size: 13px; }
    @media (max-width: 1040px) { .launch-gate { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 860px) { .grid, .two, .launch-gate { grid-template-columns: 1fr; } main { padding: 28px 14px 40px; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">Local Premortem Golden Loop Audit</div>
      <h1>${escapeHtml(path.basename(audit.root))}</h1>
      <div class="meta">
        <span class="pill">${escapeHtml(audit.status)}</span>
        <span class="pill">score ${effective.premortem.summary.score}</span>
        <span class="pill">${effective.golden_loop.pass ? 'Golden Loop pass' : 'Golden Loop needs fixes'}</span>
        <span class="pill">no-spend local receipt</span>
      </div>
    </section>

    <section class="launch-gate" aria-label="Launch Gate">
      <div class="gate-cell">
        <div class="kicker">launch gate</div>
        <h2>Source Files Read</h2>
        <p><strong>${launchGate.source_files_read.count}</strong> local file(s) discovered for audit.</p>
        <details>
          <summary>Show sampled file paths</summary>
          <ul>${sourceFileList}</ul>
        </details>
        ${sourceFileNote}
      </div>
      <div class="gate-cell">
        <div class="kicker">launch gate</div>
        <h2>Assumptions Refused</h2>
        <ul>${assumptionsRefused}</ul>
      </div>
      <div class="gate-cell">
        <div class="kicker">launch gate</div>
        <h2>Risky Action Blocked</h2>
        <ul>${riskyActionsBlocked}</ul>
      </div>
      <div class="gate-cell">
        <div class="kicker">launch gate</div>
        <h2>Exact IDE Prompt Handed Off</h2>
        <p>Artifact: <code>${escapeHtml(launchGate.ide_prompt_handed_off.artifact)}</code></p>
        <details>
          <summary>Show exact prompt</summary>
          <pre>${exactPrompt}</pre>
        </details>
      </div>
    </section>

    <section class="grid two">
      <div class="panel">
        <div class="kicker">closure loop</div>
        <h2>Fixes Applied Later</h2>
        <ul>
          <li>Previous audit found: <strong>${closure.previous_audit_found ? 'yes' : 'no'}</strong></li>
          <li>Closed recommendations: <strong>${closure.summary.closed}</strong></li>
          <li>Applied this run: <strong>${closure.summary.applied_this_run}</strong></li>
          <li>Still open: <strong>${closure.summary.still_open}</strong></li>
        </ul>
        <p class="note">This is a local comparison against prior audit artifacts and the current repo state. It does not upload code or receipts.</p>
      </div>
      <div class="panel">
        <div class="kicker">closure loop</div>
        <h2>Loop Receipts</h2>
        <p>Current: <code>${escapeHtml(closure.current_receipt_id || effective.receipt.receipt_id)}</code></p>
        <p>Previous: <code>${escapeHtml(closure.previous_receipt_id || 'none')}</code></p>
      </div>
      <div class="panel wide">
        <h2>Recommendation Closure Ledger</h2>
        <table>
          <thead><tr><th>Status</th><th>Type</th><th>Item</th><th>Evidence</th></tr></thead>
          <tbody>${closureItems}</tbody>
        </table>
      </div>
    </section>

    <section class="grid two">
      <div class="panel boundary">
        <h2>Safety Boundary</h2>
        <ul>
          <li>No deletes or overwrites.</li>
          <li>No application code rewrites.</li>
          <li>No paid execution, wallet signing, deployment, publishing, or USDC transfer.</li>
          <li>No repo contents uploaded by default.</li>
        </ul>
      </div>
      <div class="panel">
        <h2>Receipt</h2>
        <p><code>${escapeHtml(effective.receipt.receipt_id)}</code></p>
        <p>Generated ${escapeHtml(effective.receipt.generated_at)}</p>
      </div>
    </section>

    <section class="grid two">${session}</section>

    <h2>Premortem Risks</h2>
    <section class="grid">${riskCards}</section>

    <h2>Golden Loop Stages</h2>
    <section class="grid">${stageCards}</section>

    <section class="grid two">
      <div class="panel">
        <h2>Safe Additive Fixes</h2>
        <ul>${safeFixes}</ul>
        <p>Apply only after review with <code>audit --apply-safe-fixes</code>.</p>
      </div>
      <div class="panel">
        <h2>Manual Owner Actions</h2>
        <ul>${manual}</ul>
      </div>
      <div class="panel wide">
        <h2>IDE / Agent Handoff</h2>
        <p>Use <code>ide-fix-prompt.md</code> or <code>agent-handoff.md</code> with a local IDE agent. The prompt includes the guardrails and current findings.</p>
      </div>
    </section>

    <footer>Generated locally by Agoragentic Premortem Golden Loop. Network and paid paths are opt-in only.</footer>
  </main>
</body>
</html>
`;
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timestampSlug(iso) {
  return String(iso || nowIso()).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-').replace('Z', '');
}
