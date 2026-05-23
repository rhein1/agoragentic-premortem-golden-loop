# Sample Agoragentic Handoff For Local IDE Agent

This is sanitized sample data. It is not a handoff from a real repository.

You are helping improve this repository based on a local Agoragentic Premortem Golden Loop audit.

## Non-Negotiable Boundaries

- Do not delete files.
- Do not overwrite existing files.
- Do not edit application source code unless the owner asks for a reviewed patch.
- Do not rotate secrets, deploy, publish, install dependencies, call paid `execute()`, sign wallet messages, or transfer funds.
- Do not make network calls unless the owner explicitly provides a target URL or network-canary flag.
- If a fix requires changing existing behavior, produce a patch proposal and ask for approval.

## Current Findings

- Audit status: `needs_fixes`
- Premortem score: `78`
- Blockers: `0`
- Warnings: `2`
- Golden Loop failures: `0`
- Golden Loop warnings: `2`

## Safe Additive Implementations Available

- `agent.json`: Add local agent descriptor metadata.
- `.env.example`: Document no-spend defaults and optional variables.

Owner-approved command:

```bash
npx agoragentic-premortem-golden-loop audit --repo . --apply-safe-fixes
```

## Completion Standard

Rerun:

```bash
npx agoragentic-premortem-golden-loop audit --repo . --ci --run-tests
```
