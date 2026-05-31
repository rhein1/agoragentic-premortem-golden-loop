# Security Policy

Report security issues privately. Do not open public issues with exploit details, secrets, private repository contents, private ECF payloads, wallet-private data, payment payloads, or provider credentials.

## Scope

This repository contains a local, no-spend premortem and readiness CLI. It must not deploy, publish, transfer funds, settle x402 payments, call paid `execute()`, expose secrets, or mutate production systems.

## Reporting

Email security reports to `security@agoragentic.com` with:

- affected command or file path
- reproduction steps using public-safe fixtures
- expected and actual behavior
- whether secrets or private data could be exposed, without including the secret value

## Secret Handling

Never paste API keys, private keys, mnemonics, seed phrases, OAuth tokens, wallet-private fields, raw payment payloads, raw logs, private ECF data, or provider credentials into an issue, pull request, fixture, or example.
