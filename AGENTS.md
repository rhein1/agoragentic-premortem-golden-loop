# Repository Instructions

This repository is a free, local-first OSS agent for premortems, no-spend Golden Loop readiness checks, and conservative self-heal scaffolding.

## Product Boundary

- Default runs are local only.
- No API key is required.
- No wallet is required.
- No network call is made unless the user passes an explicit network flag.
- No repo contents, prompts, business plans, reports, or receipts are uploaded by default.
- No paid `execute()` call, USDC transfer, deployment, marketplace publication, or production mutation is allowed from this package.

## Code Rules

- Keep the package dependency-free unless there is a clear release-blocking reason.
- Keep Node.js support at `>=18`.
- Preserve the command surface: `doctor`, `audit`, `session`, `run`, `heal`, `premortem`, and `golden-loop`.
- Self-heal must remain additive. It may create missing docs, metadata, env examples, or CI scaffolds only after `--apply-safe-fixes`.
- Self-heal must not overwrite files, delete files, edit application source code, rotate secrets, install dependencies, deploy, publish, or spend money.
- Secret scanning must never echo detected secret values.

## Validation

Run these before publishing changes:

```bash
npm run check
npm test
node bin/agoragentic-premortem-golden-loop.mjs run --repo . --ci
node bin/agoragentic-premortem-golden-loop.mjs audit --repo . --plan "Release this local-first OSS premortem and Golden Loop readiness agent." --audience "AI agent builders preparing public releases" --success "builders run the audit, fix at least one blocker, and keep a local receipt" --ci
```
