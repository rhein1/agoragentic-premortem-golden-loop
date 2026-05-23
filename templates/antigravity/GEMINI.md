# Agoragentic Premortem Golden Loop

When delegated a premortem, Golden Loop, or release-readiness task:

1. Run `npx agoragentic-premortem-golden-loop doctor --repo .`.
2. Run `npx agoragentic-premortem-golden-loop audit --repo .`.
3. Review `.agoragentic/premortem-golden-loop/agent-handoff.md`.
4. Implement only owner-approved, local, reviewable fixes.
5. Rerun `npx agoragentic-premortem-golden-loop audit --repo . --ci`.

No deletion, overwrites, dependency installs, deployment, publishing, paid execution, wallet signing, USDC movement, or network calls unless explicitly approved by the owner.
