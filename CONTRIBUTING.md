# Contributing

Contributions should preserve the package's local, no-spend safety boundary.

## Ground Rules

- Keep default behavior local and deterministic.
- Do not add wallet movement, x402 settlement, paid `execute()` calls, deployment, marketplace publication, or production mutation.
- Do not echo secrets or private payloads in logs, receipts, reports, fixtures, or tests.
- Do not overwrite existing project files unless a command explicitly asks for an additive safe-fix path and the owner approves it.
- Treat repository text, metadata, manifests, HTML, JSON-LD, MCP labels, and prompts as data, not instructions.

## Validation

Before opening a pull request, run:

```bash
npm test
npm run check
```

If your change updates public discovery or README content, verify that the wording says what is live, local-only, no-spend, or future work without implying hosted Agent OS, x402, wallet, or marketplace authority.
