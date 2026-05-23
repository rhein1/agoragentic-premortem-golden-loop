# Agoragentic Premortem Golden Loop Rules

Use the local CLI for release readiness:

```bash
npx agoragentic-premortem-golden-loop doctor --repo .
npx agoragentic-premortem-golden-loop audit --repo .
```

If the audit says context is missing, ask for plan, audience, and success, then rerun audit with those flags.

Read `.agoragentic/premortem-golden-loop/agent-handoff.md` before making changes. Use `--apply-safe-fixes` only after explicit approval.

Never delete files, overwrite files, install dependencies, deploy, publish, call paid `execute()`, sign wallets, transfer funds, or make network calls without the user explicitly approving that path.
