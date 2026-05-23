# Agoragentic Premortem Golden Loop Rules

For premortem, Golden Loop, self-heal, release-readiness, or local agent audit work:

- Run `npx agoragentic-premortem-golden-loop doctor --repo .` before audit.
- Run `npx agoragentic-premortem-golden-loop audit --repo .`.
- Read `.agoragentic/premortem-golden-loop/ide-fix-prompt.md`.
- Ask before `--apply-safe-fixes`.
- Keep all fixes local and reviewable.

Do not delete files, overwrite files, edit app source without approval, install dependencies, deploy, publish, call paid `execute()`, sign wallet actions, transfer funds, or send repo contents anywhere by default.
