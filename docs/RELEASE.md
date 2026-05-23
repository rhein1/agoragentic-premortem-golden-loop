# Release Checklist

Release and distribution steps are owner/manual actions. This package must not publish, tag, deploy, transfer funds, or configure GitHub repository settings automatically.

## Final Validation

Run from the repository root:

```bash
npm run check
npm run assets:generate
npm test
node bin/agoragentic-premortem-golden-loop.mjs run --repo . --ci
node bin/agoragentic-premortem-golden-loop.mjs audit --repo . \
  --plan "Release this local-first OSS premortem and Golden Loop readiness agent with CLI, MCP, Docker, CI, examples, and IDE integration templates." \
  --audience "AI agent builders preparing public releases" \
  --success "builders run the audit through their IDE or local server, fix at least one blocker, and keep a local receipt" \
  --ci \
  --skip-network
npm pack --dry-run
```

## Optional Manual Smoke Tests

Docker, MCP clients, npm publishing, and GitHub social preview require local owner environments or account access.

### Docker Runtime

```bash
docker build -t agoragentic-premortem-golden-loop .
docker run --rm --network none -v "$PWD:/workspace" agoragentic-premortem-golden-loop audit --repo /workspace --ci
```

### MCP Client

Add the config from `templates/mcp/claude-desktop.json` or `templates/mcp/mcp.json` to the target MCP client, then verify these tools are visible:

- `agoragentic_doctor`
- `agoragentic_audit`
- `agoragentic_heal`
- `agoragentic_premortem`
- `agoragentic_golden_loop`
- `agoragentic_premortem_session`

Run `agoragentic_doctor` against a test repo before running `agoragentic_audit`.

## npm Publish

Manual owner action:

```bash
npm login
npm pack --dry-run
npm publish --access public
```

Do not publish until CI is green and the owner has reviewed the package contents from `npm pack --dry-run`.

## Git Tag

Manual owner action:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## GitHub Release Notes

Manual owner action. Suggested notes:

```text
v0.1.0

Initial public release of Agoragentic Premortem Golden Loop Agent.

- Local-first premortem and no-spend Golden Loop readiness CLI
- Doctor/audit onboarding flow
- HTML audit guide, local receipts, and IDE handoff prompts
- Conservative additive self-heal scaffolds
- Dependency-free MCP stdio server
- Templates for Cursor, Claude Code, Codex, Cline, Windsurf, Antigravity, GitHub Actions, Docker, and systemd
- No API key, wallet, network call, paid execution, deployment, deletion, or overwrite by default
```

Attach or reference:

- `assets/social-card.png`
- `assets/readme-hero.png`
- `docs/INTEGRATIONS.md`
- `examples/`

## GitHub Social Preview

Manual owner action:

1. Open the GitHub repository settings.
2. Find Social Preview.
3. Upload `assets/social-card.png`.
4. Save and verify the rendered preview.

## Owner Boundary

The repository can generate local readiness artifacts, examples, and handoff prompts. The owner remains responsible for npm publish, Git tags, GitHub releases, social preview settings, Docker runtime checks, and MCP client configuration.
