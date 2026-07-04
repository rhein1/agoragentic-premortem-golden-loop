# External Agent Deployment

The package can run as an opt-in HTTP agent for IDEs, schedulers, home servers, and other local or private agents that cannot speak stdio MCP.

The default package behavior remains local-first:

- no API key required
- no wallet required
- no outbound network by default
- no repository contents uploaded by default
- no paid `execute()` calls
- no deploys, publishes, deletes, overwrites, or source rewrites
- safe file creation is disabled over HTTP unless the owner explicitly enables it

## Localhost HTTP Agent

Run from the repository you want to audit:

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
  -d '{
    "plan": "Release a local-first OSS agent.",
    "audience": "AI agent builders",
    "success": "builders run the audit and close one release blocker"
  }'
```

The audit writes local artifacts under:

```text
.agoragentic/premortem-golden-loop/
```

## Private Network Or Cloud VM

Non-loopback binding requires a bearer token:

```bash
export AGORAGENTIC_EXTERNAL_AGENT_TOKEN="$(openssl rand -hex 32)"
npx --yes agoragentic-premortem-golden-loop serve \
  --repo /srv/my-agent \
  --host 0.0.0.0 \
  --port 8787
```

Authenticated request:

```bash
curl -s http://SERVER_IP:8787/audit \
  -H "authorization: Bearer $AGORAGENTIC_EXTERNAL_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"plan":"Release the agent","audience":"builders","success":"clean local receipt"}'
```

Use TLS and network-level access control before exposing this beyond a trusted private network.

## Owner-Approval Flags

HTTP callers cannot request sensitive actions unless the server owner enables them at startup:

```bash
--allow-remote-safe-fixes   # permits authenticated POST /audit or /heal with applySafeFixes=true
--allow-remote-network      # permits targetUrl checks or public no-spend canaries
--allow-internal-targets    # ALSO allow targetUrl probes to internal/loopback/link-local/RFC1918 hosts
--allow-remote-tests        # permits package.json scripts.test execution
```

Without those flags, requests for those actions return `403`.

> **SSRF note — read before enabling `--allow-remote-network`.** When this flag is
> set, an authenticated caller can supply any `targetUrl` and the server will issue
> `GET` requests to it (the URL plus `/health`, `/.well-known/agent.json`,
> `/agent.json`, `/openapi.json`, `/openapi.yaml`). The response HTTP **status,
> timing, content-type, and top-level JSON key names** are returned to the caller,
> so the endpoint can be used as a probe. By default the server refuses targets
> that resolve to loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`
> including the cloud metadata host `169.254.169.254` in any decimal/octal/hex
> encoding, `fe80::/10`), and RFC1918 private ranges (`10.0.0.0/8`,
> `172.16.0.0/12`, `192.168.0.0/16`), plus `0.0.0.0`; resolved IPs are validated
> (not just the hostname) and redirects are not auto-followed, to resist
> DNS-rebinding and redirect-to-internal attacks. Set `--allow-internal-targets`
> only in a trusted environment where probing internal hosts is intended. Apply
> egress network controls (firewall/security-group rules) when enabling remote
> network probes on a shared or cloud-hosted server.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | no | Liveness and safety boundary |
| GET | `/.well-known/agent.json` | no | Agent descriptor and endpoint metadata |
| GET | `/tools` | yes when token configured | Tool list |
| POST | `/doctor` | yes when token configured | Consent and safety boundary |
| POST | `/audit` | yes when token configured | Full audit, HTML guide, closure loop, handoff |
| POST | `/heal` | yes when token configured | Self-heal plan; safe fixes only with owner flag |
| POST | `/premortem` | yes when token configured | Repo release premortem |
| POST | `/golden-loop` | yes when token configured | No-spend Golden Loop readiness |
| POST | `/session` | yes when token configured | Plan premortem session |
| POST | `/run` | yes when token configured | Premortem plus Golden Loop receipt |

All POST bodies are JSON. If `repo` is omitted, the server uses the `--repo` root. If `repo` is supplied, it must stay inside the server's allowed root. If `out` is supplied, it must stay inside the selected repo.

The unauthenticated `/.well-known/agent.json` descriptor does **not** include the server's absolute filesystem path; it reports only `scoped: true` and `root_configured`. The absolute `allowed_root` is available to authenticated callers on `GET /tools`.

## Docker

Build:

```bash
docker build -t agoragentic-premortem-golden-loop .
```

Run as a localhost-only HTTP service:

```bash
export AGORAGENTIC_EXTERNAL_AGENT_TOKEN="$(openssl rand -hex 32)"
docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -e AGORAGENTIC_EXTERNAL_AGENT_TOKEN \
  -v "$PWD:/workspace" \
  agoragentic-premortem-golden-loop \
  serve --repo /workspace --host 0.0.0.0 --port 8787
```

Docker Compose:

```bash
export AGORAGENTIC_EXTERNAL_AGENT_TOKEN="$(openssl rand -hex 32)"
docker compose up premortem-golden-loop-server
```

The compose service publishes only to `127.0.0.1` by default.

## Systemd

Use:

```text
templates/systemd/agoragentic-premortem-golden-loop-server.service
```

Update `/srv/my-agent`, set `AGORAGENTIC_EXTERNAL_AGENT_TOKEN`, then enable the service.
