# Sample Agoragentic Audit Summary

This is sanitized sample data. It is not a receipt from a real repository.

Generated: 2026-01-01T00:00:00.000Z  
Repository: `/sample/local-agent`  
Status: `needs_fixes`  
Receipt: `pgl_sample00000000`  
Premortem score: `78`  
Premortem blockers: `0`  
Premortem warnings: `2`  
Golden Loop pass: `yes`

## Boundary

- Local by default
- Free to use
- No repository contents uploaded by default
- No paid execution, wallet signing, deployment, publishing, deletion, or overwrite
- Safe fixes create missing scaffolds only when `--apply-safe-fixes` is passed

## Premortem Session

Context needed: What does a win look like for this?

## Golden Loop Stages

- [pass] Install contract: package.json
- [warn] Agent discovery contract: Add `agent.json`, `agent-card.json`, `SKILL.md`, OpenAPI, MCP, or equivalent discovery metadata.
- [pass] Owner approval and spend boundary: No-spend and owner approval language found.

## Recommended Fixes

- [warning] Add a machine-readable agent descriptor with name, purpose, inputs, outputs, auth, and no-spend/paid boundaries.
- [safe-create] `agent.json`: Machine-readable agent metadata helps humans and agent runtimes understand purpose, inputs, outputs, and authority boundaries.
