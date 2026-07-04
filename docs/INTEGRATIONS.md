# Integrations

This package is local-first. Every integration below uses the same boundary:

- no API key required
- no wallet required
- no network calls unless explicitly flagged
- no repo contents uploaded by default
- no paid `execute()` calls
- no deploys, publishes, deletes, or overwrites
- safe fixes create only missing additive scaffolds after `--apply-safe-fixes`

## Universal CLI

Use this in any terminal, IDE, local agent, or home server shell:

```bash
npx agoragentic-premortem-golden-loop doctor --repo .
npx agoragentic-premortem-golden-loop audit --repo .
```

With launch context:

```bash
npx agoragentic-premortem-golden-loop audit --repo . \
  --plan "Describe the launch, product, agent, hire, strategy, or decision" \
  --audience "Who it is for or affects" \
  --success "What a win looks like"
```

Owner-approved additive fixes:

```bash
npx agoragentic-premortem-golden-loop audit --repo . --apply-safe-fixes
```

## IDE Agents

Copy the relevant template into the target repo, then ask the IDE agent to follow it.

| Tool | Template | Destination |
|---|---|---|
| Cursor | `templates/cursor/agoragentic-premortem-golden-loop.mdc` | `.cursor/rules/agoragentic-premortem-golden-loop.mdc` |
| Claude Code | `templates/claude/CLAUDE.md` | `CLAUDE.md` or append to an existing one |
| Codex | `templates/codex/AGENTS.md` | `AGENTS.md` or append to an existing one |
| Cline | `templates/cline/.clinerules` | `.clinerules` |
| Windsurf | `templates/windsurf/.windsurfrules` | `.windsurfrules` |
| Antigravity / Gemini-style agents | `templates/antigravity/GEMINI.md` | `GEMINI.md` or equivalent project instruction file |

All templates instruct the agent to run `doctor` first, then `audit`, then read `ide-fix-prompt.md` or `agent-handoff.md` before proposing changes.

## MCP

The package includes a dependency-free stdio MCP server:

```bash
npx --yes agoragentic-premortem-golden-loop mcp
```

Claude Desktop-style config:

```json
{
  "mcpServers": {
    "agoragentic-premortem-golden-loop": {
      "command": "npx",
      "args": [
        "--yes",
        "agoragentic-premortem-golden-loop",
        "mcp"
      ]
    }
  }
}
```

Templates:

- `templates/mcp/claude-desktop.json`
- `templates/mcp/mcp.json`

MCP tools exposed:

- `agoragentic_doctor`
- `agoragentic_audit`
- `agoragentic_heal`
- `agoragentic_premortem`
- `agoragentic_golden_loop`
- `agoragentic_premortem_session`

The MCP server writes audit artifacts only for `agoragentic_audit`, and only under the selected repo's `.agoragentic/premortem-golden-loop/` output directory unless `out` is provided.

## External HTTP Agent

Use this when another local/private agent cannot speak stdio MCP but can call HTTP.

Localhost-only:

```bash
npx --yes agoragentic-premortem-golden-loop serve --repo . --host 127.0.0.1 --port 8787
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Run an audit:

```bash
curl -s http://127.0.0.1:8787/audit \
  -H "content-type: application/json" \
  -d @templates/external-agent/audit-request.json
```

For a private network or cloud VM, set `AGORAGENTIC_EXTERNAL_AGENT_TOKEN` before binding to `0.0.0.0`. Remote safe fixes, network probes, and test execution stay disabled unless the owner starts the server with `--allow-remote-safe-fixes`, `--allow-remote-network`, or `--allow-remote-tests`.

`--allow-remote-network` lets an authenticated caller direct the server to issue `GET` requests to arbitrary `targetUrl`s and returns the response status, timing, content-type, and top-level JSON key names to the caller. Internal/loopback/link-local (including the cloud metadata host `169.254.169.254`) and RFC1918 targets are blocked by default; pass `--allow-internal-targets` only in trusted environments, and apply egress network controls when exposing this on a shared or cloud host. See `docs/EXTERNAL_AGENT.md` for details.

See `docs/EXTERNAL_AGENT.md` for endpoint details and Docker/systemd setup.

## GitHub Actions

Copy:

```text
templates/github-actions/agoragentic-premortem-golden-loop.yml
```

to:

```text
.github/workflows/agoragentic-premortem-golden-loop.yml
```

It runs:

```bash
npx --yes agoragentic-premortem-golden-loop audit --repo . --ci --skip-network
```

This fails CI when release blockers or Golden Loop failures remain.

## Docker

Build and run the local image:

```bash
docker build -t agoragentic-premortem-golden-loop .
docker run --rm --network none -v "$PWD:/workspace" agoragentic-premortem-golden-loop audit --repo /workspace
```

Docker Compose:

```bash
docker compose run --rm premortem-golden-loop doctor --repo /workspace
docker compose run --rm premortem-golden-loop audit --repo /workspace
AGORAGENTIC_EXTERNAL_AGENT_TOKEN="$(openssl rand -hex 32)" docker compose up premortem-golden-loop-server
```

The default audit service in `docker-compose.yml` uses `network_mode: "none"`. The optional HTTP server service publishes only to `127.0.0.1` by default and requires `AGORAGENTIC_EXTERNAL_AGENT_TOKEN`.

## Home Server / Systemd

Templates:

- `templates/systemd/agoragentic-premortem-golden-loop.service`
- `templates/systemd/agoragentic-premortem-golden-loop-server.service`
- `templates/systemd/agoragentic-premortem-golden-loop.timer`

Update `/srv/my-agent` to the target repo path, then install:

```bash
sudo cp templates/systemd/agoragentic-premortem-golden-loop.service /etc/systemd/system/
sudo cp templates/systemd/agoragentic-premortem-golden-loop.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agoragentic-premortem-golden-loop.timer
```

The systemd template runs `audit --ci --skip-network` as a daily no-spend readiness check.

The server template runs the opt-in HTTP external agent on `127.0.0.1:8787`. Replace the placeholder token before enabling it.

## Local Artifacts

Most integrations write or read:

```text
.agoragentic/premortem-golden-loop/audit-guide.html
.agoragentic/premortem-golden-loop/audit-summary.md
.agoragentic/premortem-golden-loop/ide-fix-prompt.md
.agoragentic/premortem-golden-loop/agent-handoff.md
.agoragentic/premortem-golden-loop/local-receipt.json
```

These are ignored local artifacts by default. Commit them only if the repo owner intentionally wants public release receipts.
