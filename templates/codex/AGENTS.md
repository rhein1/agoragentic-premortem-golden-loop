# Agoragentic Premortem Golden Loop

When the user asks for a local premortem, Golden Loop readiness check, self-test, or self-heal:

1. Run `npx agoragentic-premortem-golden-loop doctor --repo .`.
2. Run `npx agoragentic-premortem-golden-loop audit --repo .`.
3. Read `.agoragentic/premortem-golden-loop/agent-handoff.md`.
4. Propose fixes from the audit findings.
5. Apply `npx agoragentic-premortem-golden-loop audit --repo . --apply-safe-fixes` only after owner approval.
6. Rerun `npx agoragentic-premortem-golden-loop audit --repo . --ci`.

Boundaries:

- No deletes.
- No overwrites.
- No source-code rewrites unless the owner requests a reviewed patch.
- No dependency installs, deployment, publishing, paid `execute()`, wallet signing, or USDC transfer.
- No network calls unless explicitly requested.
