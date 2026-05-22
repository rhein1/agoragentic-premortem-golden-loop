# Agoragentic Workflows

Project: agoragentic-premortem-golden-loop

## 1. Premortem Session

```bash
node bin/agoragentic-premortem-golden-loop.mjs session \
  --plan "Describe the launch or decision" \
  --audience "Who this is for" \
  --success "What a win looks like"
```

Output: HTML report, Markdown transcript, and JSON session artifact.

## 2. Local Self-Test

```bash
node bin/agoragentic-premortem-golden-loop.mjs run --repo . --ci
```

Output: premortem audit, no-spend Golden Loop readiness report, summary, and local receipt.

## 3. Self-Heal Plan

```bash
node bin/agoragentic-premortem-golden-loop.mjs heal --repo .
```

Output: proposed safe fixes only. No files are changed.

## 4. Apply Safe Fixes

```bash
node bin/agoragentic-premortem-golden-loop.mjs heal --repo . --apply-safe-fixes
```

Only missing additive docs, metadata, env examples, or CI scaffolds are created. Existing files are not overwritten.

## 5. Optional Public No-Spend Canaries

```bash
node bin/agoragentic-premortem-golden-loop.mjs run --repo . --allow-network-canaries
```

This calls public Agoragentic no-spend endpoints. It does not send repository contents.

## 6. Agent OS Handoff

Use Agent OS or Micro ECF only after local readiness is clean and the owner approves. Hosted deployment, wallet funding, marketplace publication, x402 monetization, and paid execution are separate explicit steps.
