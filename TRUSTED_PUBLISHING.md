# npm Trusted Publishing

Publish `agoragentic-premortem-golden-loop` through GitHub Actions OIDC. Do not add an npm token to repository secrets.

Configure the npm package trusted publisher with:

```text
Provider: GitHub Actions
Organization/user: rhein1
Repository: agoragentic-premortem-golden-loop
Workflow filename: publish.yml
```

The release tag must equal `v` plus the version in `package.json`, for example `v0.1.7`. The workflow reruns the complete release check and fails closed when the tag and package version differ.
