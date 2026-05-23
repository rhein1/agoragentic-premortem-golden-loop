# Agoragentic Workflows

Project: agoragentic-premortem-golden-loop

## 1. Doctor / Consent Gate

```bash
node bin/agoragentic-premortem-golden-loop.mjs doctor --repo .
```

Output: local doctor artifact explaining what the agent reads, what it writes, and what it will never do.

## 2. One-Command Local Audit

```bash
node bin/agoragentic-premortem-golden-loop.mjs audit --repo . \
  --plan "Describe the launch or decision" \
  --audience "Who this is for" \
  --success "What a win looks like"
```

Output: audit guide HTML, premortem report/transcript when context is sufficient, Golden Loop receipt, healing plan, and IDE/agent handoff prompts.

## 3. Local Self-Test

```bash
node bin/agoragentic-premortem-golden-loop.mjs run --repo . --ci
```

Output: premortem audit, no-spend Golden Loop readiness report, summary, and local receipt.

## 4. Self-Heal Plan

```bash
node bin/agoragentic-premortem-golden-loop.mjs heal --repo .
```

Output: proposed safe fixes only. No files are changed.

## 5. Apply Safe Fixes

```bash
node bin/agoragentic-premortem-golden-loop.mjs audit --repo . --apply-safe-fixes
```

Only missing additive docs, metadata, env examples, or CI scaffolds are created. Existing files are not overwritten.

## 6. IDE / Agent Handoff

Use `.agoragentic/premortem-golden-loop/ide-fix-prompt.md` or `.agoragentic/premortem-golden-loop/agent-handoff.md` with a local IDE agent. The handoff prompt repeats the non-destructive boundaries and points to the exact local artifacts to inspect before proposing or applying fixes.

## 7. MCP / Docker / CI Integrations

See `docs/INTEGRATIONS.md` for ready-to-copy setup for MCP clients, Cursor, Claude Code, Codex, Cline, Windsurf, Antigravity, GitHub Actions, Docker, and systemd home-server timers.

## 8. Optional Public No-Spend Canaries

```bash
node bin/agoragentic-premortem-golden-loop.mjs audit --repo . --allow-network-canaries
```

This calls public Agoragentic no-spend endpoints. It does not send repository contents.

## 9. Agent OS Handoff

Use Agent OS or Micro ECF only after local readiness is clean and the owner approves. Hosted deployment, wallet funding, marketplace publication, x402 monetization, and paid execution are separate explicit steps.
