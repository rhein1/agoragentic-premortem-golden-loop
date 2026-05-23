# Agoragentic Premortem Golden Loop

Use this repo integration when the user asks to audit, premortem, self-test, self-heal, or prepare an agent repo for release.

Start with:

```bash
npx agoragentic-premortem-golden-loop doctor --repo .
```

Then run:

```bash
npx agoragentic-premortem-golden-loop audit --repo .
```

If the user provides launch context, include it:

```bash
npx agoragentic-premortem-golden-loop audit --repo . \
  --plan "..." \
  --audience "..." \
  --success "..."
```

Read `.agoragentic/premortem-golden-loop/ide-fix-prompt.md` before implementing anything. Use `--apply-safe-fixes` only after explicit owner approval.

Never delete files, overwrite files, rotate secrets, deploy, publish, install dependencies, call paid `execute()`, sign wallets, transfer funds, or send repo contents anywhere by default.
