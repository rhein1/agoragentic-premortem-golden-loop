# Agoragentic Safety Boundaries

Project: agoragentic-premortem-golden-loop

## Default Boundary

- Free to use.
- Local file reads only.
- Local artifact writes only.
- No API key required.
- No wallet required.
- No network calls by default.
- No repository contents, business plans, prompts, reports, or receipts are sent anywhere by default.
- No paid execution.
- No production mutation.
- No deployment.
- No marketplace publication.

## What Self-Heal May Do

Only when `--apply-safe-fixes` is passed, the agent may create missing additive scaffolds:

- `docs/AGORAGENTIC_GOALS.md`
- `docs/AGORAGENTIC_WORKFLOWS.md`
- `docs/AGORAGENTIC_SAFETY_BOUNDARIES.md`
- `agent.json`
- `.env.example`
- `.github/workflows/agoragentic-premortem-golden-loop.yml`

It does not overwrite existing files.

The `audit` command may also write local report and handoff artifacts under `.agoragentic/premortem-golden-loop/`, including `audit-guide.html`, `audit-summary.md`, `ide-fix-prompt.md`, and `agent-handoff.md`.

## What Self-Heal Will Not Do

- It will not edit application source code.
- It will not delete files.
- It will not overwrite existing files.
- It will not remove secrets automatically.
- It will not rotate credentials.
- It will not install dependencies without the user's own package manager command.
- It will not run paid `execute()` calls.
- It will not transfer USDC or sign wallet payments.
- It will not publish to Agent OS, a marketplace, npm, PyPI, or GitHub.

## Optional Network Canaries

`--allow-network-canaries` calls only public no-spend Agoragentic endpoints and sends no repo content. Keep it off for fully offline runs.
