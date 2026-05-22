# Agoragentic Goals

Project: agoragentic-premortem-golden-loop

## Primary Goal

Make an OSS agent that helps builders run a serious premortem and a no-spend Golden Loop readiness check before they publish, deploy, monetize, or expose an agent to users.

## Success Signals

- A new user can run the premortem session from a clean checkout.
- A repository owner can run `run --repo .` and receive local JSON/Markdown readiness artifacts.
- A repository owner can run `heal --repo .` and understand the exact safe fixes before anything changes.
- Any applied self-heal change is additive, reviewable, and owner-approved.
- The default boundary is obvious: free, local, no network, no data sent anywhere, no spend.

## Non-Goals

- No autonomous deployment.
- No wallet funding or USDC transfer.
- No paid `execute()` call.
- No marketplace publication.
- No secret rotation on the user's behalf.
- No upload of repo contents, prompts, plans, reports, receipts, or code.

## Owner Review Checkpoints

- Before applying generated fixes.
- Before enabling public no-spend network canaries.
- Before running declared project tests if those tests can mutate state.
- Before connecting Agent OS, Micro ECF, x402, hosted deployment, or marketplace flows.
- Before publishing any generated report publicly.
