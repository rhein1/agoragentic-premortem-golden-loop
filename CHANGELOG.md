# Changelog

All notable changes to Agoragentic Premortem Golden Loop are documented here.

## [0.1.7] - 2026-07-22

### Security
- Block loopback, link-local, cloud-metadata, carrier-grade NAT, and RFC1918 targets unless the owner explicitly enables internal target checks.
- Validate DNS results and redirect destinations before opt-in target probes to prevent SSRF and redirect escapes.
- Stop exposing the configured absolute repository root through the unauthenticated external-agent descriptor.

### Fixed
- Record whether a Golden Loop run made opt-in network calls in the local receipt instead of always reporting `network_calls: false`.

### Added
- Public discovery and workflow-contract documentation for coding-agent integrations.
- Focused receipt-boundary and external-agent security regressions.

## [0.1.6] - 2026-05-24

- Initial npm release of the local premortem, Golden Loop readiness, conservative self-heal, MCP, and external-agent surfaces.
